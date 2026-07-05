import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { logAction } from '@/observability/action-log';
import type { MmaClient } from '@/mma/client';
import type { MmaRoute } from '@/db/enums';
import { getPollManager } from '@/sse/poll-manager';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { appendBatchTerminalEvent } from '@/details/project-event-labels';

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
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, createdAt: mmaBatch.createdAt, route: mmaBatch.route })
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
          route: row.route,
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
    // SYNC: block until terminal.
    let mmaBatchId: string;
    let envelope: unknown;
    try {
      ({ batchId: mmaBatchId, envelope } = await opts.mma.dispatchAndWait(opts.route, { cwd: opts.cwd, body: payload }));
    } catch (err) {
      // Transport/dispatch itself failed (never reached a terminal envelope).
      await opts.db
        .update(mmaBatch)
        .set({ status: 'failed', result: { error: { code: 'dispatch_failed', message: String(err) } } as object, terminalAt: new Date() })
        .where(eq(mmaBatch.id, batchRowId));
      await appendBatchTerminalEvent(opts.db, opts.projectId, opts.handler, 'failed', Date.now() - row.createdAt.getTime());
      throw err;
    }

    // The MMA task reached a terminal envelope. Per the wire contract a non-null
    // `error` object means the task RAN but FAILED (e.g. reviewer_parse_failed from
    // a provider 401). Treat that as failure — NOT a silent success — so the caller's
    // retry/stop logic engages. Otherwise an audit that recorded no pass would make
    // the resolver re-dispatch "pass 1" forever (the infinite-loop bug).
    const envErr = (envelope as { error?: unknown } | null | undefined)?.error;
    const taskFailed = envErr != null && typeof envErr === 'object';
    const usage = extractUsageFields(envelope);
    await opts.db
      .update(mmaBatch)
      .set({
        status: taskFailed ? 'failed' : 'done',
        batchId: mmaBatchId,
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

    if (taskFailed) {
      // Do NOT fire the success handler — record a failed milestone and throw so the
      // driver retries (bounded) and then stops with a clear error, instead of looping.
      await appendBatchTerminalEvent(opts.db, opts.projectId, opts.handler, 'failed', Date.now() - row.createdAt.getTime());
      const e = envErr as { code?: string; message?: string };
      throw new Error(`MMA task failed: ${e.code ?? 'error'}${e.message ? `: ${e.message}` : ''}`);
    }

    // Fire the terminal handler. If it THROWS, the gating state it is the sole
    // writer of was NOT recorded — a WAITing/gated resolver would re-dispatch
    // FOREVER (the batch is `done`, so the driver's retry bound never engages and
    // the in-flight guard clears). So on a handler throw, mark the batch `failed`
    // and RETHROW, so the caller (driver) retries/stops — mirroring the async
    // PollManager path, which fails the batch on a handler throw. Closes the
    // infinite-loop door for a handler that throws on an otherwise-successful
    // envelope (e.g. an audit that returns prose → `missing_report` → handler throws).
    try {
      const { getHandler, ensureHandlersRegistered } = await import('@/dispatch/handler-registry');
      ensureHandlersRegistered();
      const h = getHandler(opts.handler);
      if (h) await h(opts.db, { batchRowId, projectId: opts.projectId ?? '', handler: opts.handler, request: opts.body, actorId: opts.actorId }, envelope);
    } catch (handlerErr) {
      console.error(`[forge] terminal handler '${opts.handler}' threw:`, handlerErr);
      await opts.db.update(mmaBatch).set({ status: 'failed', terminalAt: new Date() }).where(eq(mmaBatch.id, batchRowId));
      await appendBatchTerminalEvent(opts.db, opts.projectId, opts.handler, 'failed', Date.now() - row.createdAt.getTime());
      throw handlerErr;
    }

    // Resolve the running timeline line to its milestone + measured duration —
    // one line per activity, covering manual-UI dispatches too.
    await appendBatchTerminalEvent(opts.db, opts.projectId, opts.handler, 'done', Date.now() - row.createdAt.getTime());

    return { batchRowId, envelope };
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
