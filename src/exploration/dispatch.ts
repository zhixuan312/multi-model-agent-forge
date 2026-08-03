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
import { logEvent } from '@/observability/log-event';
import { DISCOVER_TASK_KIND, type DiscoverTaskKind, type MmaRoute } from '@/db/enums';
import { errName } from '@/lib/err';
import { discoverTaskId, ensureDiscoverTaskIds } from '@/exploration/explore-core';

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

const ROUTE_BY_KIND: Record<DiscoverTaskKind, MmaRoute> = {
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

/**
 * The word for each kind in the roll-up line — `journal` reads as "recall" there. Total over
 * `DiscoverTaskKind` so a kind added to the enum has to be given a word.
 */
const KIND_ROLLUP_WORD = {
  investigate: 'investigate',
  research: 'research',
  journal: 'recall',
} as const satisfies Record<DiscoverTaskKind, string>;

/**
 * "Analysed 6 tasks — 3 investigate · 1 research · 2 recall".
 *
 * Derived from the enum rather than counting three hand-named kinds: the old version summed
 * `investigate`/`research`/`journal` explicitly, so a fourth kind would have been dispatched,
 * counted in the total, and left out of the breakdown — a line that does not add up.
 */
function rollupLabel(tasks: Array<{ kind: DiscoverTaskKind }>): string {
  const parts = DISCOVER_TASK_KIND.map(
    (k) => `${tasks.filter((t) => t.kind === k).length} ${KIND_ROLLUP_WORD[k]}`,
  );
  return `Analysed ${tasks.length} tasks — ${parts.join(' · ')}`;
}

export type TaskDispatchOutcome =
  // `batchId` is MMA's id for the task, which `dispatchMma` types as optional because
  // a dispatch can return without one (the `dispatch_orphaned` path). This was
  // `batchId: string` with a `!` at the push site, so the type promised something the
  // producer does not.
  | { taskId: string; ok: true; batchId: string | null }
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
  task: { kind: DiscoverTaskKind; prompt: string },
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
  task: { kind: DiscoverTaskKind; targetRepoId: string | null },
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
    .map((t, i) => ({ id: discoverTaskId(t, i), kind: t.kind as DiscoverTaskKind, title: t.title ?? null, prompt: t.prompt, targetRepoId: t.repoId ?? null, index: i }))
    .filter((t) => allTasks[t.index].status === 'draft');

  const outcomes: TaskDispatchOutcome[] = [];

  if (drafts.length === 0) return outcomes;

  // Load the triggering member so both the roll-up and the failure notice below are
  // actor-aware, and derive source from the actor (auto driver → Forge/'mma', human →
  // member/'user'), per FR-7.
  const [rollupActor] = await db
    .select({ displayName: member.displayName, avatarTint: member.avatarTint })
    .from(member)
    .where(eq(member.id, actor.id))
    .limit(1);
  const activityActor = {
    id: actor.id,
    name: rollupActor?.displayName ?? 'Forge',
    tint: rollupActor?.avatarTint ?? '#9a6b4f',
  };
  const activitySource = actor.id === FORGE_MEMBER_ID ? 'mma' as const : 'user' as const;

  await recordActivity({
    db,
    projectId,
    stage: 'exploration',
    phase: 'discover',
    label: rollupLabel(drafts),
    kind: 'done',
    actor: activityActor,
    source: activitySource,
    eventKey: `discover-rollup:${projectId}:${discoverTaskSetHash(drafts)}`,
  });

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
      logEvent({ level: 'error', event: 'dispatch.failure', projectId, taskId: task.id, detail: 'cwd_missing' });
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
        // `taskId` also rides in meta, not only in the opts: opts.taskId reaches the
        // PollManager in memory, while meta persists to the batch row's `request` — which
        // is the only place a rehydrate after a restart can recover it from.
        meta: { taskId: task.id, taskKind: task.kind, title: task.title, targetRepoId: task.kind === 'investigate' ? task.targetRepoId : null },
        await: false,
      }));
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 300) : errName(err);
      logEvent({ level: 'error', event: 'dispatch.failure', projectId, taskId: task.id, detail });
      outcomes.push({ taskId: task.id, ok: false, reason: 'dispatch_failed', message: 'MMA dispatch failed.' });
      continue;
    }

    // Link the task + flip to running. The attempt's `batchId` is the batch ROW id —
    // the key the PollManager terminal flip matches (`a.batchId === entry.batchId`).
    // No transaction: `updateDetails` is one optimistic read-modify-write with its own
    // retry loop, so wrapping it bought nothing and cost a `tx as unknown as Db` cast.
    await updateDetails(db, projectId, (det) => {
      // By ID, not by the position captured before the dispatch. `updateDetails` re-reads
      // on every CAS attempt, so a concurrent add or remove between attempts would have
      // pointed this at a different task — and it writes the attempt and flips the status.
      const tasks = det.stages.exploration.phases.discover.tasks;
      // Resolve against the ids as they stand, THEN heal — the id captured before the
      // dispatch may be the legacy positional form, which a healed task no longer answers to.
      const t = tasks.find((x, i) => discoverTaskId(x, i) === task.id) ?? tasks[task.index];
      ensureDiscoverTaskIds(tasks);
      if (t) {
        t.status = 'running';
        t.attempts.push({ batchId: batchRowId, status: 'running', at: new Date().toISOString() });
      }
      return det;
    });

    outcomes.push({ taskId: task.id, ok: true, batchId: batchId ?? null });
  }

  // A task that could not be dispatched stays `draft` and its row never appears, so
  // without this the rail just shows it sitting there. The outcomes below used to be
  // the only record — and the one production caller discards the return value, so the
  // whole `TaskDispatchOutcome` type was read by tests alone while a real user got no
  // signal at all beyond a line in the server log.
  const failures = outcomes.filter((o): o is Extract<TaskDispatchOutcome, { ok: false }> => !o.ok);
  if (failures.length > 0) {
    const detail = failures.map((f) => f.message).join(' · ');
    await recordActivity({
      db,
      projectId,
      stage: 'exploration',
      phase: 'discover',
      label: `${failures.length} of ${drafts.length} discovery tasks could not start — ${detail}`.slice(0, 400),
      kind: 'error',
      actor: activityActor,
      source: activitySource,
      // No eventKey: every attempt should be visible, and the idempotency index would
      // collapse a repeat failure into silence.
    });
  }

  return outcomes;
}

