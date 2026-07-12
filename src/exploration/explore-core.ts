import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { PROMPT_FLOORS } from '@/exploration/schemas';
import { readExplorationFile } from '@/projects/project-files';
import { setBriefText } from '@/details/write';
import { getBriefText, getRepos } from '@/details/read';
import { validateDetails } from '@/details/schema';
import type { RailTask } from '@/hooks/useProjectEvents';

/**
 * Brief persistence + the explore rail/summary reads.
 * Brain-dump text: `project.brief_md` column in DB (short user input, never exported).
 * Rail tasks: `exploration_task` joined to `mma_batch` for live status.
 * Exploration summary: file-based at `.mma/projects/<id>/exploration.md`.
 */

export const briefSchema = z.object({ text: z.string().max(100_000) });

/** Save the brain-dump to details. */
export async function saveBrief(
  projectId: string,
  text: string,
  actor: { id: string },
  db: Db = getDb(),
): Promise<void> {
  await setBriefText(db, projectId, text);
}

export async function latestBrief(projectId: string, db: Db = getDb()): Promise<string> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (row?.details) return getBriefText(validateDetails(row.details));
  return '';
}

/** The rail's task list joined to its live mma_batch status/headline/error. */
export async function readRailTasks(projectId: string, db: Db = getDb()): Promise<RailTask[]> {
  const { inArray } = await import('drizzle-orm');
  const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!pRow?.details) return [];
  const d = validateDetails(pRow.details);
  const tasks = d.stages.exploration.phases.discover.tasks;
  if (tasks.length === 0) return [];

  const batchIds = tasks.flatMap((t) => t.attempts.map((a) => a.batchId)).filter(Boolean);
  const batches = batchIds.length > 0
    ? await db.select({ id: mmaBatch.id, status: mmaBatch.status, result: mmaBatch.result })
        .from(mmaBatch).where(inArray(mmaBatch.id, batchIds))
    : [];
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  const rows = tasks.map((t, i) => {
    const lastAttempt = t.attempts[t.attempts.length - 1];
    const batch = lastAttempt ? batchMap.get(lastAttempt.batchId) : undefined;
    return {
      id: `task-${i}`,
      kind: t.kind,
      status: t.status,
      prompt: t.prompt,
      targetRepoId: t.repoId ?? null,
      mmaBatchId: lastAttempt?.batchId ?? null,
      batchStatus: batch?.status ?? null,
      result: batch?.result ?? null,
    };
  });

  return rows.map((r) => {
    const env = (r.result ?? {}) as Record<string, unknown>;
    const err = null;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = output.summary;
    let outputMd: string | null = null;
    if (typeof summary === 'string') {
      outputMd = summary;
    } else if (summary && typeof summary === 'object') {
      const s = summary as Record<string, unknown>;
      const answer = typeof s.answer === 'string' ? s.answer
        : typeof s.summary === 'string' ? s.summary
        : null;
      const findings = Array.isArray(s.findings) ? s.findings as Array<Record<string, unknown>> : [];
      const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      findings.sort((a, b) => (SEVERITY_ORDER[String(a.weight)] ?? 9) - (SEVERITY_ORDER[String(b.weight)] ?? 9));
      const parts: string[] = [];
      if (answer) parts.push(answer);
      if (findings.length > 0) {
        parts.push('\n\n---\n\n### Supporting evidence\n');
        for (const f of findings) {
          const weight = String(f.weight ?? '').toUpperCase();
          const claim = String(f.claim ?? '');
          const evidence = f.evidence ? `\n  > ${String(f.evidence)}` : '';
          const file = f.file && f.line ? `\n  *${f.file}:${f.line}*` : f.file ? `\n  *${f.file}*` : '';
          parts.push(`- **[${weight}]** ${claim}${evidence}${file}`);
        }
      }
      outputMd = parts.length > 0 ? parts.join('\n') : JSON.stringify(s, null, 2);
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
): Promise<ExploreArtifact | null> {
  const file = await readExplorationFile(projectId);
  if (!file) return null;
  return { id: projectId, version: file.version, bodyMd: file.bodyMd };
}

/** Project repo subset (for the investigate target selector). */
export async function readProjectRepoOptions(
  projectId: string,
  db: Db = getDb(),
): Promise<{ id: string; name: string }[]> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (row?.details) return getRepos(validateDetails(row.details)).map((r) => ({ id: r.id, name: r.name }));
  return [];
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

/** Add a manual draft task via details. */
export async function addTask(
  projectId: string,
  input: { kind: 'investigate' | 'research' | 'journal'; targetRepoId?: string | null; prompt: string },
  actor: { id: string },
  db: Db = getDb(),
): Promise<{ id: string }> {
  const prompt = input.prompt.trim();
  if (prompt.length < PROMPT_FLOORS[input.kind]) throw new TaskLockedError();
  const { updateDetails } = await import('@/details/write');
  let idx = 0;
  await updateDetails(db, projectId, (d) => {
    d.stages.exploration.phases.discover.tasks.push({
      kind: input.kind,
      prompt,
      status: 'draft',
      ...(input.kind === 'investigate' && input.targetRepoId ? { repoId: input.targetRepoId } : {}),
      attempts: [],
    });
    idx = d.stages.exploration.phases.discover.tasks.length - 1;
    return d;
  });
  return { id: `task-${idx}` };
}

/** Edit a draft task's prompt and/or target repo via details. */
export async function editTask(
  projectId: string,
  taskIndex: number,
  patch: { prompt?: string; targetRepoId?: string | null },
  actor: { id: string },
  db: Db = getDb(),
): Promise<void> {
  const { updateDetails } = await import('@/details/write');
  await updateDetails(db, projectId, (d) => {
    const task = d.stages.exploration.phases.discover.tasks[taskIndex];
    if (!task || task.status !== 'draft') return d;
    if (patch.prompt !== undefined) task.prompt = patch.prompt.trim();
    if (patch.targetRepoId !== undefined && task.kind === 'investigate') {
      task.repoId = patch.targetRepoId ?? undefined;
    }
    return d;
  });
}

/** Remove a draft task via details. */
export async function removeTask(
  projectId: string,
  taskIndex: number,
  actor: { id: string },
  db: Db = getDb(),
): Promise<void> {
  const { updateDetails } = await import('@/details/write');
  await updateDetails(db, projectId, (d) => {
    const task = d.stages.exploration.phases.discover.tasks[taskIndex];
    if (!task || task.status !== 'draft') return d;
    d.stages.exploration.phases.discover.tasks.splice(taskIndex, 1);
    return d;
  });
}
