import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { member } from '@/db/schema/identity';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { loopRun } from '@/db/schema/loop';
import { logAction } from '@/observability/action-log';
import type { MmaClient } from '@/mma/client';
import type { MmaRoute } from '@/db/enums';
import { getPollManager } from '@/sse/poll-manager';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { appendBatchTerminalEvent, phaseKeyForHandler } from '@/details/project-event-labels';

/**
 * Thrown by the G2 guard when a project already has MMA in flight for a DIFFERENT
 * phase — the caller must WAIT (auto driver) or surface "busy" (manual route),
 * never dispatch a second phase concurrently.
 */
export class PhaseBusyError extends Error {
  constructor(readonly projectId: string, readonly wantPhase: string, readonly busyPhase: string) {
    super(`Project ${projectId} is busy in phase "${busyPhase}"; cannot start "${wantPhase}" (one phase at a time).`);
    this.name = 'PhaseBusyError';
  }
}

export interface DispatchOpts {
  db: Db;
  mma: MmaClient;
  projectId: string | null;
  route: MmaRoute;
  /**
   * The registered terminal-handler key, OR `null` for **inline-consume**: the caller
   * reads the returned `envelope` itself (sync `await:true` only) and no terminal
   * handler runs. A NAMED-but-unregistered handler still fails loudly (the F1 guard);
   * only an explicit `null` is exempt. Loops / journal-recall's sync variants are the
   * inline-consumers. Async (`await:false`) with `handler:null` is invalid.
   */
  handler: string | null;
  /**
   * Display/trace label for the `ops_mma_batch.handler` column when `handler` is
   * `null` (inline-consume). Lets a handler-less dispatch still be traceable/cost-
   * attributed by name (e.g. `'loop-work'`). Ignored when `handler` is a string.
   */
  label?: string;
  cwd: string;
  body: unknown;
  actorId: string | null;
  meta?: Record<string, unknown>;
  await?: boolean;
  loopRunId?: string;
  /**
   * Exploration-discover fan-out only: the owning `exploration_task` id. Threaded
   * to the PollManager so its terminal poll flips the matching task to `recorded`
   * (the generic taskId path — no per-task terminal handler needed). Async-only;
   * ignored on the sync path.
   */
  taskId?: string | null;
}

async function resolveBatchTeamId(opts: Pick<DispatchOpts, 'db' | 'projectId' | 'loopRunId' | 'actorId'>): Promise<string> {
  if (opts.projectId) {
    const [projectRow] = await opts.db
      .select({ teamId: project.teamId })
      .from(project)
      .where(eq(project.id, opts.projectId))
      .limit(1);
    if (projectRow?.teamId) return projectRow.teamId;
    throw new Error(`Dispatch requires a team-scoped project: ${opts.projectId}`);
  }

  if (opts.loopRunId) {
    const [loopRunRow] = await opts.db
      .select({ teamId: loopRun.teamId })
      .from(loopRun)
      .where(eq(loopRun.id, opts.loopRunId))
      .limit(1);
    if (loopRunRow?.teamId) return loopRunRow.teamId;
    throw new Error(`Dispatch requires a team-scoped loop run: ${opts.loopRunId}`);
  }

  if (opts.actorId) {
    const [actorRow] = await opts.db
      .select({ teamId: member.teamId })
      .from(member)
      .where(eq(member.id, opts.actorId))
      .limit(1);
    if (actorRow?.teamId) return actorRow.teamId;
    throw new Error(`Dispatch actor is not team-scoped: ${opts.actorId}`);
  }

  throw new Error('Dispatch requires a resolvable teamId.');
}

export async function findInflight(
  db: Db,
  projectId: string | null,
  handler?: string | null,
  actorId?: string | null,
): Promise<string | null> {
  const conditions = [
    inArray(mmaBatch.status, ['dispatched', 'running']),
  ];

  // `handler` omitted → PROJECT-LEVEL single-flight check (ANY in-flight MMA batch
  // for the project). With a handler → the classic per-handler check.
  if (handler) {
    conditions.push(eq(mmaBatch.handler, handler));
  }

  if (projectId) {
    conditions.push(eq(mmaBatch.projectId, projectId));
  } else {
    conditions.push(sql`${mmaBatch.projectId} IS NULL`);
  }

  if (actorId) {
    conditions.push(eq(mmaBatch.dispatchedBy, actorId));
  }

  const [row] = await db
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, createdAt: mmaBatch.createdAt, route: mmaBatch.route, handler: mmaBatch.handler })
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
          handler: row.handler ?? handler ?? undefined,
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
 *
 * `handler: null` = no terminal handler runs. Two shapes:
 *   - SYNC (`await:true`) — **inline-consume**: the caller reads the returned `envelope`
 *     (loops).
 *   - ASYNC (`await:false`) — **fire-and-row-poll**: the PollManager persists the
 *     terminal envelope onto the `ops_mma_batch` row (it does this for every batch,
 *     handler or not) and an EXTERNAL consumer polls that row for it (journal recall).
 * Either way, a NAMED-but-unregistered handler still fails loudly (the F1 guard); only
 * an explicit `null` opts out. The async path returns the external MMA `batchId` too,
 * which the row-poller keys off.
 */
export async function dispatchMma(
  opts: DispatchOpts,
): Promise<{ batchRowId: string; envelope?: unknown; batchId?: string }> {
  const payload = { type: opts.route, ...(opts.body as Record<string, unknown>) };

  // The handler's `ctx.request` is body + meta merged — the SAME shape persisted to
  // the batch row's `request` column — so a terminal handler reads dispatch-time
  // context (e.g. plan-refine's `taskId`, passed via `meta`) regardless of whether
  // it fires on the sync path (below) or the async PollManager path (which rehydrates
  // `request` from the row). Passing bare `opts.body` here dropped `meta` → handlers
  // that key off a meta field got `undefined` and threw.
  const request = { ...(opts.body as object), ...opts.meta };

  // The row's handler column carries the registered handler key, OR the label when
  // inline-consume (handler:null) — so a handler-less dispatch stays traceable by name.
  const rowHandler = opts.handler ?? opts.label ?? null;

  const teamId = await resolveBatchTeamId(opts);

  const values = {
    projectId: opts.projectId,
    teamId,
    route: opts.route,
    handler: rowHandler,
    cwd: opts.cwd,
    status: 'dispatched' as const,
    request: request as object,
    dispatchedBy: opts.actorId,
    ...(opts.loopRunId && { loopRunId: opts.loopRunId }),
  };

  // 1. Insert the batch row BEFORE dispatch — every attempt is tracked. G2: under a
  // per-project advisory lock (closes the check→insert TOCTOU), REFUSE if any
  // in-flight batch belongs to a DIFFERENT phase — one phase per project at a time.
  // Same-phase is fan-out (exploration/discover, multi-repo execute) and always
  // allowed. Project-less dispatches (global journal-recall) and phase-less handlers
  // skip the guard.
  const myPhase = phaseKeyForHandler(opts.handler);
  let row: { id: string; createdAt: Date };
  if (opts.projectId && myPhase) {
    const pid = opts.projectId;
    row = await opts.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${pid})::bigint)`);
      const inflight = await tx
        .select({ handler: mmaBatch.handler })
        .from(mmaBatch)
        .where(and(eq(mmaBatch.projectId, pid), inArray(mmaBatch.status, ['dispatched', 'running'])));
      const conflict = inflight.map((b) => phaseKeyForHandler(b.handler)).find((p): p is string => !!p && p !== myPhase);
      if (conflict) throw new PhaseBusyError(pid, myPhase, conflict);
      const [inserted] = await tx.insert(mmaBatch).values(values).returning({ id: mmaBatch.id, createdAt: mmaBatch.createdAt });
      return inserted;
    });
  } else {
    [row] = await opts.db.insert(mmaBatch).values(values).returning({ id: mmaBatch.id, createdAt: mmaBatch.createdAt });
  }

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
    // Inline-consume (handler:null): the caller reads the returned `envelope` — no
    // terminal handler runs and NO throw. This is the sanctioned path for project-less
    // callers (loops, journal-recall's sync variant) that consume the result directly.
    // A NAMED-but-unregistered handler still fails loudly below (the F1 guard) — the
    // exemption is ONLY for an explicit `null`, never for a name that failed to register.
    if (opts.handler !== null) {
      try {
        const { getHandler, ensureHandlersRegistered } = await import('@/dispatch/handler-registry');
        await ensureHandlersRegistered();
        const h = getHandler(opts.handler);
        if (!h) {
          // A batch-backed dispatch with a NAMED but missing handler records no gating
          // state, so a WAITing resolver re-dispatches forever (the batch is `done`).
          // Fail loudly — the catch below marks the batch failed + rethrows so the
          // driver retries/stops with a clear error instead of looping.
          throw new Error(`No terminal handler registered for '${opts.handler}'`);
        }
        await h(opts.db, { batchRowId, projectId: opts.projectId ?? '', handler: opts.handler, request, actorId: opts.actorId }, envelope);
      } catch (handlerErr) {
        console.error(`[forge] terminal handler '${opts.handler}' threw:`, handlerErr);
        await opts.db.update(mmaBatch).set({ status: 'failed', terminalAt: new Date() }).where(eq(mmaBatch.id, batchRowId));
        await appendBatchTerminalEvent(opts.db, opts.projectId, opts.handler, 'failed', Date.now() - row.createdAt.getTime());
        throw handlerErr;
      }
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
        taskId: opts.taskId ?? null,
        createdAt: row.createdAt,
      });

      // Return the external MMA batchId too — project-less pollers (journal recall)
      // key off it to read terminal state from the row.
      return { batchRowId, batchId: mmaBatchId };
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
