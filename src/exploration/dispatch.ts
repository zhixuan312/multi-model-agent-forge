import { stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { MmaClient } from '@/mma/client';
import { buildMmaClient } from '@/mma/server-client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { PollManager, getPollManager } from '@/sse/poll-manager';
import { logAction } from '@/observability/action-log';
import { logPoll } from '@/observability/poll-log';
import type { MmaRoute } from '@/db/enums';

/**
 * Dispatch selected `draft` exploration tasks. One `mma_batch` per task:
 * investigate → repo's `path_on_disk`; research/journal → workspace root.
 * Insert + task-link + status-flip is ONE transaction per task — a dispatch
 * failure rolls it all back (task stays `draft`, no `mma_batch` row).
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
  // research: background ← latest brief from details
  const { getBriefText } = await import('@/details/read');
  const { validateDetails } = await import('@/details/schema');
  let briefText: string | null = null;
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (row?.details) briefText = getBriefText(validateDetails(row.details));
  const background =
    (briefText?.trim() || 'Exploration for this project; see the brief and attachments.').slice(0, 8000);
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

  // Read draft tasks from details
  const { validateDetails } = await import('@/details/schema');
  const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!pRow?.details) return [];
  const d = validateDetails(pRow.details);
  const allTasks = d.stages.exploration.phases.discover.tasks;
  const drafts = allTasks
    .map((t, i) => ({ id: `task-${i}`, kind: t.kind as 'investigate' | 'research' | 'journal', prompt: t.prompt, targetRepoId: t.repoId ?? null, index: i }))
    .filter((t) => allTasks[t.index].status === 'draft');

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
      // Update task status + attempt in details
      const { updateDetails } = await import('@/details/write');
      await updateDetails(tx as unknown as Db, projectId, (det) => {
        const idx = (task as any).index;
        if (det.stages.exploration.phases.discover.tasks[idx]) {
          det.stages.exploration.phases.discover.tasks[idx].status = 'running';
          det.stages.exploration.phases.discover.tasks[idx].attempts.push({
            batchId: b.id, status: 'running', at: new Date().toISOString(),
          });
        }
        return det;
      });
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
