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
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, projectId),
        eq(mmaBatch.handler, handler),
        inArray(mmaBatch.status, ['dispatched', 'running']),
      ),
    )
    .limit(1);
  return row?.id ?? null;
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
