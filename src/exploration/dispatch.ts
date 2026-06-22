import { stat } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { artifact } from '@/db/schema/artifacts';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { MmaClient } from '@/mma/client';
import { buildMmaClient } from '@/mma/server-client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { PollManager, getPollManager } from '@/sse/poll-manager';
import { logAction } from '@/observability/action-log';
import { logPoll } from '@/observability/poll-log';
import type { MmaRoute } from '@/db/enums';

/**
 * Dispatch selected `draft` tasks (Spec 5 flow C). One `mma_batch` per task on
 * the standard tier (selected by MMA config, not per-call): investigate → the
 * one repo's `path_on_disk`; research / journal → the workspace root. The
 * insert + task-link + status-flip is ONE transaction per task — a dispatch
 * (POST) failure rolls it all back (task stays `draft`, no `mma_batch` row). The
 * cwd is `fs.stat`-verified before dispatch; a missing path leaves the task
 * `draft` with an error rather than 400-ing at MMA's cwd-confinement.
 */

const ROUTE_BY_KIND: Record<'investigate' | 'research' | 'journal', MmaRoute> = {
  investigate: 'investigate',
  research: 'research',
  journal: 'journal_recall',
};

export type TaskDispatchOutcome =
  | { taskId: string; ok: true; batchId: string }
  | { taskId: string; ok: false; reason: 'cwd_missing' | 'dispatch_failed'; message: string };

export interface DispatchDeps {
  db?: Db;
  client?: MmaClient;
  pollManager?: PollManager;
  workspaceRoot?: string;
  /** Injectable fs.stat for tests (avoids needing a real path on disk). */
  statPath?: (p: string) => Promise<void>;
}

async function defaultStat(p: string): Promise<void> {
  await stat(p);
}

/** Build the per-route request body folding the brief into research background. */
async function buildBody(
  db: Db,
  projectId: string,
  task: { kind: 'investigate' | 'research' | 'journal'; prompt: string },
): Promise<Record<string, unknown>> {
  if (task.kind === 'investigate') return { question: task.prompt };
  if (task.kind === 'journal') return { query: task.prompt };
  // research: background ← latest brief (≥20 floor; pad with a neutral context note
  // ONLY to satisfy the structural floor when the brief is short — the prompt is
  // never auto-padded, the BACKGROUND context is).
  const [brief] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration_brief')))
    .orderBy(artifact.version)
    .limit(1);
  const background =
    (brief?.bodyMd?.trim() || 'Exploration for this project; see the brief and attachments.').slice(0, 8000);
  return { researchQuestion: task.prompt, background };
}

/** Resolve a task's cwd: investigate → repo path; research/journal → workspace root. */
async function resolveCwd(
  db: Db,
  workspaceRoot: string,
  task: { kind: 'investigate' | 'research' | 'journal'; targetRepoId: string | null },
): Promise<string | null> {
  if (task.kind !== 'investigate') return workspaceRoot;
  if (!task.targetRepoId) return null;
  const [r] = await db
    .select({ pathOnDisk: repo.pathOnDisk })
    .from(repo)
    .where(eq(repo.id, task.targetRepoId))
    .limit(1);
  return r?.pathOnDisk ?? null;
}

/** Dispatch all `draft` tasks for a project (or a given subset of ids). */
export async function dispatchTasks(
  projectId: string,
  actor: { id: string },
  deps: DispatchDeps = {},
  taskIds?: string[],
): Promise<TaskDispatchOutcome[]> {
  const db = deps.db ?? getDb();
  const client = deps.client ?? (await buildMmaClient({ db }));
  const pm = deps.pollManager ?? getPollManager();
  const workspaceRoot = deps.workspaceRoot ?? resolveWorkspaceRoot();
  const statPath = deps.statPath ?? defaultStat;

  const drafts = await db
    .select({
      id: explorationTask.id,
      kind: explorationTask.kind,
      prompt: explorationTask.prompt,
      targetRepoId: explorationTask.targetRepoId,
    })
    .from(explorationTask)
    .where(
      taskIds
        ? and(eq(explorationTask.projectId, projectId), eq(explorationTask.status, 'draft'), inArray(explorationTask.id, taskIds))
        : and(eq(explorationTask.projectId, projectId), eq(explorationTask.status, 'draft')),
    );

  const outcomes: TaskDispatchOutcome[] = [];

  for (const task of drafts) {
    const route = ROUTE_BY_KIND[task.kind];
    const cwd = await resolveCwd(db, workspaceRoot, task);
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

    // Dispatch FIRST (no DB writes yet) so a failure leaves zero rows.
    let batchId: string;
    try {
      if (task.kind === 'investigate') {
        ({ batchId } = await client.investigate(cwd, { prompt: task.prompt }));
      } else if (task.kind === 'research') {
        ({ batchId } = await client.research(cwd, {
          prompt: `${body.researchQuestion as string}\n\nBackground: ${body.background as string}`,
        }));
      } else {
        ({ batchId } = await client.journalRecall(cwd, { prompt: task.prompt }));
      }
    } catch (err) {
      // Surface the real cause — MmaClient error messages are safe (no token);
      // logging only the error NAME masked every failure as a bare "Error".
      const detail = err instanceof Error ? err.message.slice(0, 300) : errName(err);
      logPoll({ level: 'error', event: 'dispatch.failure', projectId, taskId: task.id, detail });
      outcomes.push({ taskId: task.id, ok: false, reason: 'dispatch_failed', message: 'MMA dispatch failed.' });
      continue;
    }

    // Insert the mma_batch row + link the task + flip to running — atomically.
    const mmaBatchRowId = await db.transaction(async (tx) => {
      const [b] = await tx
        .insert(mmaBatch)
        .values({
          projectId,
          route,
          targetRepoId: task.kind === 'investigate' ? task.targetRepoId : null,
          cwd,
          batchId,
          status: 'dispatched',
          request: body,
          dispatchedBy: actor.id,
        })
        .returning({ id: mmaBatch.id, createdAt: mmaBatch.createdAt });
      await tx
        .update(explorationTask)
        .set({ status: 'running', mmaBatchId: b.id })
        .where(eq(explorationTask.id, task.id));
      await logAction(
        {
          projectId,
          memberId: actor.id,
          action: 'explore_run',
          target: `exploration_task:${task.id}`,
          meta: { route },
        },
        tx as unknown as Db,
      );
      return { id: b.id, createdAt: b.createdAt };
    });

    pm.register({
      batchId: mmaBatchRowId.id,
      mmaBatchId: batchId,
      projectId,
      route,
      taskId: task.id,
      createdAt: mmaBatchRowId.createdAt,
    });
    outcomes.push({ taskId: task.id, ok: true, batchId });
  }

  return outcomes;
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
