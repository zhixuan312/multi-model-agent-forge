import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { logAction } from '@/observability/action-log';
import type { MmaClient } from '@/mma/client';
import type { MmaRoute } from '@/db/enums';
import { getPollManager } from '@/sse/poll-manager';
import { extractUsageFields } from '@/usage/extract-usage-fields';

export interface DispatchOpts {
  db: Db;
  mma: MmaClient;
  projectId: string | null;
  route: MmaRoute;
  handler: string;
  cwd: string;
  body: unknown;
  actorId: string | null;
  meta?: Record<string, unknown>;
  await?: boolean;
  loopRunId?: string;
}

export async function findInflight(
  db: Db,
  projectId: string | null,
  handler: string,
  actorId?: string | null,
): Promise<string | null> {
  const conditions = [
    eq(mmaBatch.handler, handler),
    inArray(mmaBatch.status, ['dispatched', 'running']),
  ];

  if (projectId) {
    conditions.push(eq(mmaBatch.projectId, projectId));
  } else {
    conditions.push(sql`${mmaBatch.projectId} IS NULL`);
  }

  if (actorId) {
    conditions.push(eq(mmaBatch.dispatchedBy, actorId));
  }

  const [row] = await db
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(and(...conditions))
    .limit(1);
  if (!row) return null;

  if (row.batchId) {
    const pm = getPollManager();
    if (!pm.isRegistered(row.id)) {
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
      if (opts.projectId) {
        const { projectEventBus } = await import('@/sse/event-bus');
        projectEventBus.publish(opts.projectId, { type: 'dispatch.failed', batchId: batchRowId, handler: opts.handler, error: String(err) });
      }
    });

  return batchRowId;
}

/**
 * Unified MMA dispatch — the ONE function for every MMA call.
 *
 * `await: false` (default): async — insert batch row, dispatch to MMA, register
 * with PollManager. Returns `{ batchRowId }` immediately.
 *
 * `await: true`: sync — insert batch row, block until MMA returns the terminal
 * envelope, extract usage, update row. Returns `{ batchRowId, envelope }`.
 *
 * Both modes: batch row inserted BEFORE dispatch (every attempt tracked), usage
 * extracted on terminal, handler fired on terminal (best-effort).
 */
export async function dispatchMma(opts: DispatchOpts): Promise<{ batchRowId: string; envelope?: unknown }> {
  const payload = { type: opts.route, ...(opts.body as Record<string, unknown>) };

  // 1. Insert batch row BEFORE dispatch — every attempt is tracked
  const [row] = await opts.db
    .insert(mmaBatch)
    .values({
      projectId: opts.projectId,
      route: opts.route,
      handler: opts.handler,
      cwd: opts.cwd,
      status: 'dispatched',
      request: { ...(opts.body as object), ...opts.meta } as object,
      dispatchedBy: opts.actorId,
      ...(opts.loopRunId && { loopRunId: opts.loopRunId }),
    })
    .returning({ id: mmaBatch.id, createdAt: mmaBatch.createdAt });

  const batchRowId = row.id;

  // Best-effort action log
  if (opts.actorId) {
    await logAction(
      { projectId: opts.projectId, memberId: opts.actorId, action: 'dispatch', target: `batch:${batchRowId}` },
      opts.db,
    ).catch(() => {});
  }

  if (opts.await) {
    // SYNC: block until terminal
    try {
      const envelope = await opts.mma.dispatchAndWait(opts.route, { cwd: opts.cwd, body: payload });
      const usage = extractUsageFields(envelope);
      await opts.db
        .update(mmaBatch)
        .set({
          status: 'done',
          result: (envelope ?? {}) as object,
          terminalAt: new Date(),
          ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
          ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
          ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
          ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
          ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
          ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
        })
        .where(eq(mmaBatch.id, batchRowId));

      // Fire handler (best-effort)
      try {
        const { getHandler, ensureHandlersRegistered } = await import('@/dispatch/handler-registry');
        ensureHandlersRegistered();
        const h = getHandler(opts.handler);
        if (h) await h(opts.db, { batchRowId, projectId: opts.projectId ?? '', handler: opts.handler, request: opts.body, actorId: opts.actorId }, envelope);
      } catch { /* handler failure logged, not propagated */ }

      return { batchRowId, envelope };
    } catch (err) {
      await opts.db
        .update(mmaBatch)
        .set({ status: 'failed', result: { error: { code: 'dispatch_failed', message: String(err) } } as object, terminalAt: new Date() })
        .where(eq(mmaBatch.id, batchRowId));
      throw err;
    }
  } else {
    // ASYNC: dispatch + PollManager
    try {
      const { batchId: mmaBatchId } = await opts.mma.dispatch(opts.route, { cwd: opts.cwd, body: payload });
      await opts.db
        .update(mmaBatch)
        .set({ batchId: mmaBatchId })
        .where(eq(mmaBatch.id, batchRowId));

      getPollManager().register({
        batchId: batchRowId,
        mmaBatchId,
        projectId: opts.projectId,
        route: opts.route,
        handler: opts.handler,
        taskId: null,
        createdAt: row.createdAt,
      });

      return { batchRowId };
    } catch (err) {
      // Dispatch failed — mark the pre-inserted row as failed
      await opts.db
        .update(mmaBatch)
        .set({ status: 'failed', result: { error: { code: 'dispatch_failed', message: String(err) } } as object, terminalAt: new Date() })
        .where(eq(mmaBatch.id, batchRowId));
      throw err;
    }
  }
}
