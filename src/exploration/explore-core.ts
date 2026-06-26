import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { repo } from '@/db/schema/workspace';
import { projectRepo } from '@/db/schema/projects';
import { logAction } from '@/observability/action-log';
import { PROMPT_FLOORS } from '@/exploration/schemas';
import { readExplorationSummary } from '@/projects/project-files';
import type { RailTask } from '@/hooks/useProjectEvents';

/**
 * Brief persistence + the explore rail/summary reads (Spec 5 flow A + D + E).
 * The brain-dump free text is saved as `artifact(kind='exploration_brief')`;
 * re-saving bumps its version. The rail joins exploration_task → mma_batch for
 * the live status/headline/error; the summary reads the latest exploration
 * artifact.
 */

export const briefSchema = z.object({ text: z.string().max(100_000) });

/** Save the brain-dump as a versioned exploration_brief artifact (max+1). */
export async function saveBrief(
  projectId: string,
  text: string,
  actor: { id: string },
  db: Db = getDb(),
): Promise<{ version: number }> {
  const [{ v } = { v: null }] = await db
    .select({ v: artifact.version })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration_brief')))
    .orderBy(desc(artifact.version))
    .limit(1);
  const nextVersion = (v ?? 0) + 1;
  await db.transaction(async (tx) => {
    await tx
      .insert(artifact)
      .values({ projectId, kind: 'exploration_brief', bodyMd: text, version: nextVersion, createdBy: actor.id });
    await logAction(
      { projectId, memberId: actor.id, action: 'explore_brief', target: `project:${projectId}`, meta: { version: nextVersion } },
      tx as unknown as Db,
    );
  });
  return { version: nextVersion };
}

export async function latestBrief(projectId: string, db: Db = getDb()): Promise<string> {
  const [row] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration_brief')))
    .orderBy(desc(artifact.version))
    .limit(1);
  return row?.bodyMd ?? '';
}

/** The rail's task list joined to its live mma_batch status/headline/error. */
export async function readRailTasks(projectId: string, db: Db = getDb()): Promise<RailTask[]> {
  const rows = await db
    .select({
      id: explorationTask.id,
      kind: explorationTask.kind,
      status: explorationTask.status,
      prompt: explorationTask.prompt,
      targetRepoId: explorationTask.targetRepoId,
      mmaBatchId: explorationTask.mmaBatchId,
      batchStatus: mmaBatch.status,
      result: mmaBatch.result,
    })
    .from(explorationTask)
    .leftJoin(mmaBatch, eq(explorationTask.mmaBatchId, mmaBatch.id))
    .where(eq(explorationTask.projectId, projectId))
    .orderBy(explorationTask.createdAt);

  return rows.map((r) => {
    const env = (r.result ?? {}) as Record<string, unknown>;
    const errObj = env.error as { code?: string; message?: string; kind?: string } | undefined;
    const err =
      errObj && errObj.kind !== 'not_applicable' && errObj.code
        ? { code: errObj.code, message: errObj.message ?? 'The task failed.' }
        : null;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = output.summary;
    let outputMd: string | null = null;
    if (typeof summary === 'string') {
      outputMd = summary;
    } else if (summary && typeof summary === 'object') {
      const s = summary as Record<string, unknown>;
      outputMd = typeof s.answer === 'string' ? s.answer
        : typeof s.summary === 'string' ? s.summary
        : JSON.stringify(s, null, 2);
    }
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      prompt: r.prompt,
      targetRepoId: r.targetRepoId,
      mmaBatchId: r.mmaBatchId,
      batchStatus: r.batchStatus ?? null,
      headline: typeof env.headline === 'string' ? env.headline : null,
      error: err,
      outputMd,
    };
  });
}

export interface ExploreArtifact {
  id: string;
  version: number;
  bodyMd: string;
}

/** The latest synthesized exploration artifact (the summary pane). */
export async function latestExplorationArtifact(
  projectId: string,
  _db?: Db,
): Promise<ExploreArtifact | null> {
  const bodyMd = readExplorationSummary(projectId);
  if (!bodyMd) return null;
  return { id: projectId, version: 1, bodyMd };
}

/** Project repo subset (for the investigate target selector). */
export async function readProjectRepoOptions(
  projectId: string,
  db: Db = getDb(),
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: repo.id, name: repo.name })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, projectId));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Per-route prompt floor (re-exported for the editor guard). */
export const promptFloor = (kind: 'investigate' | 'research' | 'journal'): number => PROMPT_FLOORS[kind];

/** Thrown when a mutation targets a non-`draft` (running/recorded) task. */
export class TaskLockedError extends Error {
  constructor() {
    super('Only draft tasks can be edited.');
    this.name = 'TaskLockedError';
  }
}

/** Add a manual draft task to the fan-out (validated against floor + repo subset). */
export async function addTask(
  projectId: string,
  input: { kind: 'investigate' | 'research' | 'journal'; targetRepoId?: string | null; prompt: string },
  actor: { id: string },
  db: Db = getDb(),
): Promise<{ id: string }> {
  const prompt = input.prompt.trim();
  if (prompt.length < PROMPT_FLOORS[input.kind]) throw new TaskLockedError();
  let targetRepoId: string | null = null;
  if (input.kind === 'investigate') {
    const opts = await readProjectRepoOptions(projectId, db);
    if (!input.targetRepoId || !opts.some((o) => o.id === input.targetRepoId)) {
      throw new TaskLockedError();
    }
    targetRepoId = input.targetRepoId;
  }
  const [row] = await db.transaction(async (tx) => {
    const r = await tx
      .insert(explorationTask)
      .values({ projectId, kind: input.kind, targetRepoId, prompt, status: 'draft', createdBy: actor.id })
      .returning({ id: explorationTask.id });
    await logAction(
      { projectId, memberId: actor.id, action: 'explore_add_task', target: `project:${projectId}`, meta: { kind: input.kind } },
      tx as unknown as Db,
    );
    return r;
  });
  return { id: row.id };
}

/** Edit a draft task's prompt and/or target repo. Rejects non-draft rows. */
export async function editTask(
  projectId: string,
  taskId: string,
  patch: { prompt?: string; targetRepoId?: string | null },
  actor: { id: string },
  db: Db = getDb(),
): Promise<void> {
  const [task] = await db
    .select({ status: explorationTask.status, kind: explorationTask.kind })
    .from(explorationTask)
    .where(and(eq(explorationTask.id, taskId), eq(explorationTask.projectId, projectId)))
    .limit(1);
  if (!task) throw new TaskLockedError();
  if (task.status !== 'draft') throw new TaskLockedError();

  const set: Record<string, unknown> = {};
  if (patch.prompt !== undefined) {
    const p = patch.prompt.trim();
    if (p.length < PROMPT_FLOORS[task.kind]) throw new TaskLockedError();
    set.prompt = p;
  }
  if (patch.targetRepoId !== undefined && task.kind === 'investigate') {
    const opts = await readProjectRepoOptions(projectId, db);
    if (!patch.targetRepoId || !opts.some((o) => o.id === patch.targetRepoId)) throw new TaskLockedError();
    set.targetRepoId = patch.targetRepoId;
  }
  if (Object.keys(set).length === 0) return;
  await db.transaction(async (tx) => {
    await tx.update(explorationTask).set(set).where(eq(explorationTask.id, taskId));
    await logAction(
      { projectId, memberId: actor.id, action: 'explore_edit_task', target: `exploration_task:${taskId}` },
      tx as unknown as Db,
    );
  });
}

/** Remove a draft task (× in the editor). Rejects non-draft rows. */
export async function removeTask(
  projectId: string,
  taskId: string,
  actor: { id: string },
  db: Db = getDb(),
): Promise<void> {
  const [task] = await db
    .select({ status: explorationTask.status })
    .from(explorationTask)
    .where(and(eq(explorationTask.id, taskId), eq(explorationTask.projectId, projectId)))
    .limit(1);
  if (!task) throw new TaskLockedError();
  if (task.status !== 'draft') throw new TaskLockedError();
  await db.transaction(async (tx) => {
    await tx.delete(explorationTask).where(eq(explorationTask.id, taskId));
    await logAction(
      { projectId, memberId: actor.id, action: 'explore_remove_task', target: `exploration_task:${taskId}` },
      tx as unknown as Db,
    );
  });
}
