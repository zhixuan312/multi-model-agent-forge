import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { member } from '@/db/schema/identity';
import { MmaClient } from '@/mma/client';
import { buildMmaClient } from '@/mma/server-client';
import { resolveProjectWorkspaceRoot } from '@/projects/project-workspace';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import { updateDetails } from '@/details/write';
import { recordActivity } from '@/activity/project-activity';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { logPoll } from '@/observability/poll-log';
import type { MmaRoute } from '@/db/enums';

/**
 * Dispatch selected `draft` exploration tasks — one `ops_mma_batch` per task,
 * fanned out through the CENTRALIZED `dispatchMma` path (async / fire-and-row-poll):
 * investigate → repo's `path_on_disk`; research/journal → workspace root.
 *
 * `dispatchMma` owns the row insert, MMA dispatch, and PollManager registration.
 * Discover carries no terminal *handler* (`handler: null`) — its terminal side
 * effect (flip the owning task to `recorded`) is the PollManager's generic
 * `taskId` path, driven by the `taskId` we thread in. After a successful dispatch
 * we link the task in `details` (attempt keyed by the batch ROW id, which the
 * PollManager flip matches) and flip it to `running`. A dispatch failure leaves the
 * row `failed` (every attempt is tracked — the harmonized standard) and the task
 * stays `draft`.
 */

const ROUTE_BY_KIND: Record<'investigate' | 'research' | 'journal', MmaRoute> = {
  investigate: 'investigate',
  research: 'research',
  journal: 'journal_recall',
};

/** Dedup-safe roll-up key: a hash of the confirmed task set (kind:prompt:repoId, sorted).
 * Re-dispatching the SAME set collapses to one row; a DIFFERENT set is a distinct row.
 */
function discoverTaskSetHash(tasks: Array<{ kind: string; prompt: string; repoId?: string | null }>): string {
  return createHash('sha256')
    .update([...tasks].map((t) => `${t.kind}:${t.prompt}:${t.repoId ?? ''}`).sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
}

function rollupLabel(tasks: Array<{ kind: 'investigate' | 'research' | 'journal' }>): string {
  const counts = {
    investigate: tasks.filter((t) => t.kind === 'investigate').length,
    research: tasks.filter((t) => t.kind === 'research').length,
    journal: tasks.filter((t) => t.kind === 'journal').length,
  };
  return `Analysed ${tasks.length} tasks — ${counts.investigate} investigate · ${counts.research} research · ${counts.journal} recall`;
}

export type TaskDispatchOutcome =
  | { taskId: string; ok: true; batchId: string }
  | { taskId: string; ok: false; reason: 'cwd_missing' | 'dispatch_failed'; message: string };

export interface DispatchDeps {
  db?: Db;
  client?: MmaClient;
  workspaceRoot?: string;
  /** Injectable fs.stat for tests (avoids needing a real path on disk). */
  statPath?: (p: string) => Promise<void>;
}

async function defaultStat(p: string): Promise<void> {
  await stat(p);
}

/**
 * Build the per-route WIRE body — the exact `{ prompt, ... }` shape MMA's task
 * routes expect (matching the old MmaClient.investigate/research/journalRecall
 * wrappers), so `dispatchMma` can send it directly. research folds the latest
 * brief into a `Background:` suffix.
 */
async function buildBody(
  db: Db,
  projectId: string,
  task: { kind: 'investigate' | 'research' | 'journal'; prompt: string },
): Promise<Record<string, unknown>> {
  if (task.kind === 'investigate') return { prompt: task.prompt };
  if (task.kind === 'journal') return { prompt: task.prompt };
  // research: fold the latest brief into the prompt's background.
  const { getBriefText } = await import('@/details/read');
  const { validateDetails } = await import('@/details/schema');
  let briefText: string | null = null;
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (row?.details) briefText = getBriefText(validateDetails(row.details));
  const background =
    (briefText?.trim() || 'Exploration for this project; see the brief.').slice(0, 8000);
  return { prompt: `${task.prompt}\n\nBackground: ${background}` };
}

/**
 * Resolve a task's cwd: investigate → repo path; research/journal → workspace root.
 *
 * The `targetRepoId` is client-supplied, so it is double-gated: it must be one of the
 * project's OWN repos (`allowedRepoIds`, from details.repos) AND belong to the project's
 * team (`eq(repo.teamId, teamId)`). Without this an investigate worker could be pointed
 * at another team's repo directory and return its source in the exploration artifact.
 */
async function resolveCwd(
  db: Db,
  workspaceRoot: string,
  task: { kind: 'investigate' | 'research' | 'journal'; targetRepoId: string | null },
  allowedRepoIds: Set<string>,
  teamId: string,
): Promise<string | null> {
  if (task.kind !== 'investigate') return workspaceRoot;
  if (!task.targetRepoId) return null;
  if (!allowedRepoIds.has(task.targetRepoId)) return null; // not in the project's repo subset
  const [r] = await db
    .select({ pathOnDisk: repo.pathOnDisk })
    .from(repo)
    .where(and(eq(repo.id, task.targetRepoId), eq(repo.teamId, teamId)))
    .limit(1);
  return r?.pathOnDisk ?? null;
}

/** Dispatch all `draft` tasks for a project. */
export async function dispatchTasks(
  projectId: string,
  actor: { id: string },
  deps: DispatchDeps = {},
): Promise<TaskDispatchOutcome[]> {
  const db = deps.db ?? getDb();
  const client = deps.client ?? (await buildMmaClient({ db }));
  // research/journal tasks run at the project's TEAM workspace root (its journal
  // + repos live there), not a shared global root. investigate overrides with the
  // target repo's path in resolveCwd.
  const workspaceRoot = deps.workspaceRoot ?? (await resolveProjectWorkspaceRoot(projectId, db));
  const statPath = deps.statPath ?? defaultStat;

  // Read draft tasks from details
  const { validateDetails } = await import('@/details/schema');
  const [pRow] = await db.select({ details: project.details, teamId: project.teamId }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!pRow?.details) return [];
  const d = validateDetails(pRow.details);
  // investigate targetRepoId is client-supplied — restrict it to this project's own
  // repo subset (already team-verified at create/changeRepos) plus the project's team.
  const allowedRepoIds = new Set((d.repos ?? []).map((r) => r.id));
  const projectTeamId = pRow.teamId;
  const allTasks = d.stages.exploration.phases.discover.tasks;
  const drafts = allTasks
    .map((t, i) => ({ id: `task-${i}`, kind: t.kind as 'investigate' | 'research' | 'journal', title: t.title ?? null, prompt: t.prompt, targetRepoId: t.repoId ?? null, index: i }))
    .filter((t) => allTasks[t.index].status === 'draft');

  const outcomes: TaskDispatchOutcome[] = [];

  // before the loop — load the triggering member so the roll-up row is actor-aware, and
  // derive source from the actor (auto driver → Forge/'mma', human → member/'user'), per FR-7.
  if (drafts.length > 0) {
    const [rollupActor] = await db
      .select({ displayName: member.displayName, avatarTint: member.avatarTint })
      .from(member)
      .where(eq(member.id, actor.id))
      .limit(1);
    await recordActivity({
      db,
      projectId,
      stage: 'exploration',
      phase: 'discover',
      label: rollupLabel(drafts),
      kind: 'done',
      actor: { id: actor.id, name: rollupActor?.displayName ?? 'Forge', tint: rollupActor?.avatarTint ?? '#9a6b4f' },
      source: actor.id === FORGE_MEMBER_ID ? 'mma' : 'user',
      eventKey: `discover-rollup:${projectId}:${discoverTaskSetHash(drafts)}`,
    });
  }

  for (const task of drafts) {
    const route = ROUTE_BY_KIND[task.kind];
    const cwd = await resolveCwd(db, workspaceRoot, task, allowedRepoIds, projectTeamId);
    if (!cwd) {
      outcomes.push({ taskId: task.id, ok: false, reason: 'cwd_missing', message: 'No cwd for task.' });
      continue;
    }
    try {
      await statPath(cwd);
    } catch {
      logPoll({ level: 'error', event: 'dispatch.failure', projectId, taskId: task.id, detail: 'cwd_missing' });
      outcomes.push({ taskId: task.id, ok: false, reason: 'cwd_missing', message: `cwd not found: ${cwd}` });
      continue;
    }

    const body = await buildBody(db, projectId, task);

    // Centralized dispatch: async fire-and-row-poll. `dispatchMma` inserts the row,
    // dispatches, and registers the PollManager (with our taskId, so its terminal
    // poll flips the matching task to `recorded`). Throws on dispatch failure —
    // leaving the row `failed` (attempt tracked) and the task `draft`.
    let batchRowId: string;
    let batchId: string | undefined;
    try {
      ({ batchRowId, batchId } = await dispatchMma({
        db,
        mma: client,
        projectId,
        route,
        handler: null,
        label: `discover-${task.kind}`,
        cwd,
        body,
        actorId: actor.id,
        taskId: task.id,
        meta: { taskKind: task.kind, title: task.title, targetRepoId: task.kind === 'investigate' ? task.targetRepoId : null },
        await: false,
      }));
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 300) : errName(err);
      logPoll({ level: 'error', event: 'dispatch.failure', projectId, taskId: task.id, detail });
      outcomes.push({ taskId: task.id, ok: false, reason: 'dispatch_failed', message: 'MMA dispatch failed.' });
      continue;
    }

    // Link the task + flip to running. The attempt's `batchId` is the batch ROW id —
    // the key the PollManager terminal flip matches (`a.batchId === entry.batchId`).
    await db.transaction(async (tx) => {
      await updateDetails(tx as unknown as Db, projectId, (det) => {
        const t = det.stages.exploration.phases.discover.tasks[task.index];
        if (t) {
          t.status = 'running';
          t.attempts.push({ batchId: batchRowId, status: 'running', at: new Date().toISOString() });
        }
        return det;
      });
    });

    outcomes.push({ taskId: task.id, ok: true, batchId: batchId! });
  }

  return outcomes;
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
