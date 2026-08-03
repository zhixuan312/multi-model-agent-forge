import { randomUUID } from 'node:crypto';
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
import { compareSeverity } from '@/lib/severity';
import type { DiscoverTaskKind } from '@/db/enums';
import { interpretTerminal } from '@/sse/envelope';

/**
 * Brief persistence + the explore rail/summary reads.
 *
 * Brain-dump text: `details.stages.exploration.phases.brief.text` (via `setBriefText`).
 * Rail tasks: `details.stages.exploration.phases.discover.tasks`, joined to `ops_mma_batch`
 *   for live status.
 * Exploration summary: file-based at `.mma/projects/<id>/exploration.md`.
 *
 * Both of the first two used to be described as their own storage — a `project.brief_md`
 * column and an `exploration_task` table. The column exists and is dead; the table never
 * did. Everything moved into `details` and nothing here reads either.
 */

export const briefSchema = z.object({ text: z.string().max(100_000) });

/**
 * Save the brain-dump to details.
 *
 * Takes no actor: this and the three task mutators below each declared an
 * `actor: { id: string }` none of them read, so every caller threaded a member id
 * into a parameter that went nowhere. There is no audit log for them to write to.
 */
export async function saveBrief(projectId: string, text: string, db: Db = getDb()): Promise<void> {
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
      id: discoverTaskId(t, i),
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
    // `const err = null` used to sit here, so every rail task reported no error even
    // though the batch's terminal envelope carries one — dispatch_orphaned,
    // task_not_found, dispatch_failed, handler_error, forge_poll_timeout. The Explore
    // rail's failed-task pane reads `error?.message ?? 'Unknown error.'`, so that is
    // what a user saw for all of them. `interpretTerminal` is the one reader of this
    // shape; it also knows `{kind:'not_applicable'}` is the SUCCESS sentinel, not an
    // error, which a hand-rolled `env.error` read here would have got wrong.
    const err = interpretTerminal(r.result).error;
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
      // Ordering lives in @/lib/severity — findings.tsx is a client module, so the two
      // sides cannot share a constant directly; they share this one instead.
      findings.sort((a, b) => compareSeverity(String(a.weight), String(b.weight)));
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

/**
 * A task's stable id, falling back to its positional id for a row that predates the field.
 * The fallback is what an existing rail already renders, so an in-flight client keeps working
 * — and the first mutation on that project assigns real ids to everything.
 */
export function discoverTaskId(task: { id?: string }, index: number): string {
  return task.id ?? `task-${index}`;
}

/** Give every task an id. Cheap, idempotent, and run inside every discover mutation. */
export function ensureDiscoverTaskIds(tasks: Array<{ id?: string }>): void {
  for (const t of tasks) if (!t.id) t.id = randomUUID();
}

/**
 * Resolve a task id to its position. Accepts a real id, or the legacy `task-<n>` form for a
 * client that loaded before the ids existed. Returns -1 when it names nothing.
 */
function indexOfTask(tasks: Array<{ id?: string }>, taskId: string): number {
  const byId = tasks.findIndex((t) => t.id === taskId);
  if (byId !== -1) return byId;
  const m = /^task-(\d+)$/.exec(taskId);
  if (!m) return -1;
  const i = Number(m[1]);
  // A positional id only means anything for a task that never got a real one; once a task
  // HAS an id, position is not its name any more.
  return tasks[i] && !tasks[i]!.id ? i : -1;
}

/** Per-route prompt floor (re-exported for the editor guard). */
export const promptFloor = (kind: DiscoverTaskKind): number => PROMPT_FLOORS[kind];

/**
 * Thrown when a mutation targets a non-`draft` (running/recorded) task.
 *
 * `editTask`/`removeTask` used to just `return d` in that case, so the route replied
 * `{ ok: true }` and the row stayed exactly as it was — the lock reported success
 * while enforcing nothing, and their `TaskLockedError` import was unreachable.
 */
export class TaskLockedError extends Error {
  constructor() {
    super('Only draft tasks can be edited.');
    this.name = 'TaskLockedError';
  }
}

/** Thrown when a task index names no task (a stale rail, or a hand-made request). */
export class TaskNotFoundError extends Error {
  constructor() {
    super('That task no longer exists.');
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Thrown when a prompt is below its route's floor. This used to throw
 * `TaskLockedError`, so a user whose research prompt was too short was told
 * "Only draft tasks can be edited." — the route surfaces `err.message` verbatim.
 */
export class PromptTooShortError extends Error {
  constructor(kind: keyof typeof PROMPT_FLOORS) {
    super(`A ${kind} prompt needs at least ${PROMPT_FLOORS[kind]} characters.`);
    this.name = 'PromptTooShortError';
  }
}

/** Add a manual draft task via details. */
export async function addTask(
  projectId: string,
  input: { kind: DiscoverTaskKind; targetRepoId?: string | null; prompt: string },
  db: Db = getDb(),
): Promise<{ id: string }> {
  const prompt = input.prompt.trim();
  if (prompt.length < PROMPT_FLOORS[input.kind]) throw new PromptTooShortError(input.kind);
  const { updateDetails } = await import('@/details/write');
  const id = randomUUID();
  await updateDetails(db, projectId, (d) => {
    const tasks = d.stages.exploration.phases.discover.tasks;
    ensureDiscoverTaskIds(tasks);
    tasks.push({
      id,
      kind: input.kind,
      prompt,
      status: 'draft',
      ...(input.kind === 'investigate' && input.targetRepoId ? { repoId: input.targetRepoId } : {}),
      attempts: [],
    });
    return d;
  });
  return { id };
}

/** Edit a draft task's prompt and/or target repo via details. */
export async function editTask(
  projectId: string,
  taskId: string,
  patch: { prompt?: string; targetRepoId?: string | null },
  db: Db = getDb(),
): Promise<void> {
  const { updateDetails } = await import('@/details/write');
  await updateDetails(db, projectId, (d) => {
    const tasks = d.stages.exploration.phases.discover.tasks;
    // RESOLVE FIRST, heal second. `ensureDiscoverTaskIds` gives every task a real id, and
    // the legacy `task-<n>` form only answers for a task that has none — so healing before
    // the lookup makes the legacy path unresolvable, which is the very client this is for.
    const idx = indexOfTask(tasks, taskId);
    ensureDiscoverTaskIds(tasks);
    const task = tasks[idx];
    if (!task) throw new TaskNotFoundError();
    if (task.status !== 'draft') throw new TaskLockedError();
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      // The same floor `addTask` applies. Skipping it here let an edit park a task
      // below the length its own route will reject at dispatch time.
      if (prompt.length < PROMPT_FLOORS[task.kind]) throw new PromptTooShortError(task.kind);
      task.prompt = prompt;
    }
    if (patch.targetRepoId !== undefined && task.kind === 'investigate') {
      task.repoId = patch.targetRepoId ?? undefined;
    }
    return d;
  });
}

/** Remove a draft task via details. */
export async function removeTask(
  projectId: string,
  taskId: string,
  db: Db = getDb(),
): Promise<void> {
  const { updateDetails } = await import('@/details/write');
  await updateDetails(db, projectId, (d) => {
    const tasks = d.stages.exploration.phases.discover.tasks;
    // Resolve before healing — see `editTask`.
    const idx = indexOfTask(tasks, taskId);
    ensureDiscoverTaskIds(tasks);
    const task = tasks[idx];
    if (!task) throw new TaskNotFoundError();
    if (task.status !== 'draft') throw new TaskLockedError();
    tasks.splice(idx, 1);
    return d;
  });
}
