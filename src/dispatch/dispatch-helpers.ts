import { eq, and, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { logAction } from '@/observability/action-log';
import type { MmaClient } from '@/mma/client';
import type { MmaRoute } from '@/db/enums';
import { getPollManager } from '@/sse/poll-manager';

export interface DispatchOpts {
  db: Db;
  mma: MmaClient;
  projectId: string;
  route: MmaRoute;
  handler: string;
  cwd: string;
  body: unknown;
  actorId: string;
  /** Extra metadata stored on the batch row but NOT sent to MMA. */
  meta?: Record<string, unknown>;
}

export async function findInflight(
  db: Db,
  projectId: string,
  handler: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, projectId),
        eq(mmaBatch.handler, handler),
        inArray(mmaBatch.status, ['dispatched', 'running']),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Active health check: verify the MMA task still exists.
  // If MMA restarted, the task is gone (404) — fail this batch immediately
  // so the user can re-dispatch. This is the self-recovery path.
  if (row.batchId) {
    const pm = getPollManager();
    if (!pm.isRegistered(row.id)) {
      // PollManager lost track (server restart). Probe MMA directly.
      try {
        const { buildMmaClient } = await import('@/mma/server-client');
        const mma = await buildMmaClient({ db });
        const probe = await mma.poll(row.batchId);
        if (probe.state === 'not_found') {
          await db
            .update(mmaBatch)
            .set({ status: 'failed', result: { error: { code: 'task_not_found', message: 'MMA task no longer exists — server may have restarted.' } } as object, terminalAt: new Date() })
            .where(eq(mmaBatch.id, row.id));
          return null;
        }
        // Still alive — re-register with PollManager so it resumes polling
        pm.register({
          batchId: row.id,
          mmaBatchId: row.batchId,
          projectId,
          route: 'orchestrate',
          taskId: null,
          handler,
          createdAt: row.createdAt,
        });
      } catch {
        // MMA unreachable — keep the batch as in-flight, PollManager will retry
      }
    }
  }
  return row.id;
}

/**
 * Return all handler names with in-flight batches for a project.
 * Used by server components to seed the client's busy state on page load.
 */
export async function findPendingHandlers(
  db: Db,
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ handler: mmaBatch.handler })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, projectId),
        inArray(mmaBatch.status, ['dispatched', 'running']),
      ),
    );
  return rows.map((r) => r.handler).filter((h): h is string => !!h);
}

export interface LocalDispatchOpts {
  db: Db;
  projectId: string;
  handler: string;
  actorId: string;
  work: () => Promise<unknown>;
}

/**
 * Run a function in the background, tracked by ops_mma_batch. For LLM calls
 * that don't go through MMA dispatch (e.g. direct Anthropic calls in synthesize/fan-out).
 * Creates a batch row, runs the work, persists the result, emits SSE.
 */
export async function dispatchLocal(opts: LocalDispatchOpts): Promise<string> {
  const existing = await findInflight(opts.db, opts.projectId, opts.handler);
  if (existing) return existing;

  const [row] = await opts.db
    .insert(mmaBatch)
    .values({
      projectId: opts.projectId,
      route: 'orchestrate',
      handler: opts.handler,
      cwd: '.',
      status: 'dispatched',
      request: { handler: opts.handler } as object,
      dispatchedBy: opts.actorId,
    })
    .returning({ id: mmaBatch.id });

  const batchRowId = row.id;

  // Run in background — don't await
  opts.work()
    .then(async (result) => {
      await opts.db
        .update(mmaBatch)
        .set({ status: 'done', result: (result ?? {}) as object, terminalAt: new Date() })
        .where(eq(mmaBatch.id, batchRowId));
      const { projectEventBus } = await import('@/sse/event-bus');
      projectEventBus.publish(opts.projectId, { type: 'dispatch.done', batchId: batchRowId, handler: opts.handler });
    })
    .catch(async (err) => {
      await opts.db
        .update(mmaBatch)
        .set({ status: 'failed', result: { error: String(err) } as object, terminalAt: new Date() })
        .where(eq(mmaBatch.id, batchRowId));
      const { projectEventBus } = await import('@/sse/event-bus');
      projectEventBus.publish(opts.projectId, { type: 'dispatch.failed', batchId: batchRowId, handler: opts.handler, error: String(err) });
    });

  return batchRowId;
}

export async function dispatchAndRegister(opts: DispatchOpts): Promise<string> {
  const payload = { type: opts.route, ...(opts.body as Record<string, unknown>) };
  const { batchId: mmaBatchId } = await opts.mma.dispatch(opts.route, {
    cwd: opts.cwd,
    body: payload,
  });

  const [row] = await opts.db
    .insert(mmaBatch)
    .values({
      projectId: opts.projectId,
      route: opts.route,
      handler: opts.handler,
      cwd: opts.cwd,
      batchId: mmaBatchId,
      status: 'dispatched',
      request: { ...(opts.body as object), ...opts.meta } as object,
      dispatchedBy: opts.actorId,
    })
    .returning({ id: mmaBatch.id, createdAt: mmaBatch.createdAt });

  await logAction(
    { projectId: opts.projectId, memberId: opts.actorId, action: 'dispatch', target: `batch:${row.id}` },
    opts.db,
  );

  getPollManager().register({
    batchId: row.id,
    mmaBatchId,
    projectId: opts.projectId,
    route: opts.route,
    handler: opts.handler,
    taskId: null,
    createdAt: row.createdAt,
  });

  return row.id;
}
