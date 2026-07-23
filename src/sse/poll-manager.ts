import { eq, and, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { MmaClient } from '@/mma/client';
import { buildMmaClient } from '@/mma/server-client';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import {
  interpretTerminal,
  terminalEvent,
  FORGE_POLL_TIMEOUT_ERROR,
  type TerminalState,
} from '@/sse/envelope';
import { logPoll } from '@/observability/poll-log';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { updateDetails } from '@/details/write';
import { appendBatchTerminalEvent, buildDiscoverTerminalLabel } from '@/details/project-event-labels';
import { recordActivity } from '@/activity/project-activity';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { getHandler, ensureHandlersRegistered } from '@/dispatch/handler-registry';

/**
 * Server-owned MMA poll loop (Spec 5 §SSE). The browser NEVER polls MMA; this
 * singleton owns the poll loop over in-flight `mma_batch` rows, persists each
 * terminal envelope, flips the owning `exploration_task` to `recorded`, and
 * emits `task.progress`/`task.done`/`task.failed` to the per-project bus.
 *
 * Concrete, testable behaviors:
 *  - base poll interval 2s; transient errors back off `min(2s·2^n, 30s)` ±20% jitter,
 *    resetting on a successful poll. Transient errors NEVER fail a batch.
 *  - a batch with no terminal envelope >1h after `created_at` is force-failed
 *    (`forge_poll_timeout`) — the only non-MMA-originated failure transition.
 *  - rehydrates in-flight batches (`status IN ('dispatched','running')`) on boot.
 */

export const POLL_BASE_INTERVAL_MS = 2_000;
export const POLL_BACKOFF_CAP_MS = 30_000;
export const POLL_HARD_TIMEOUT_MS = 60 * 60_000;
const JITTER = 0.2;

/** Pure backoff for a transient-error attempt (0-indexed): min(2s·2^n, 30s)±20%. */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(POLL_BASE_INTERVAL_MS * 2 ** attempt, POLL_BACKOFF_CAP_MS);
  const jitterFactor = 1 + (rand() * 2 - 1) * JITTER; // [0.8, 1.2]
  return Math.round(base * jitterFactor);
}

/** What a single poll resolved to (returned by `pollOnce` for deterministic tests). */
export type PollOutcome =
  | { kind: 'pending'; headline: string }
  | { kind: 'terminal'; state: TerminalState }
  | { kind: 'timeout' }
  | { kind: 'transient'; attempt: number; backoffMs: number }
  | { kind: 'gone' };

interface RegisteredBatch {
  batchId: string; // the row id
  mmaBatchId: string; // MMA's returned batch id
  projectId: string | null;
  route: string;
  taskId: string | null;
  handler: string | null;
  createdAt: Date;
  attempt: number; // transient-error attempt counter
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PollManagerDeps {
  db?: Db;
  bus?: ProjectEventBus;
  client?: MmaClient;
  now?: () => number;
  rand?: () => number;
}

export class PollManager {
  private readonly db: Db;
  private readonly bus: ProjectEventBus;
  private clientPromise: Promise<MmaClient> | null;
  private readonly now: () => number;
  private readonly rand: () => number;
  private readonly inFlight = new Map<string, RegisteredBatch>();
  /** When true, the timer loop is suppressed (deterministic `pollOnce` tests). */
  private timersEnabled = true;

  constructor(deps: PollManagerDeps = {}) {
    this.db = deps.db ?? getDb();
    this.bus = deps.bus ?? projectEventBus;
    this.clientPromise = deps.client ? Promise.resolve(deps.client) : null;
    this.now = deps.now ?? Date.now;
    this.rand = deps.rand ?? Math.random;
    // Warm the handler registry. This is a fire-and-forget kickstart — a real
    // import failure surfaces where the memoized promise is AWAITED (the terminal
    // handler fire below, and the sync dispatch path). The `.catch` only stops the
    // floating kickstart from being an unhandled rejection (e.g. a test env torn
    // down mid-import); it does NOT swallow errors for the await sites.
    void ensureHandlersRegistered().catch(() => {});
    // Auto-rehydrate is triggered by getPollManager(), not the constructor,
    // so tests can create instances without side effects.
  }

  /** Suppress timer scheduling — tests drive `pollOnce` by hand. */
  disableTimers(): void {
    this.timersEnabled = false;
  }

  private async client(): Promise<MmaClient> {
    if (!this.clientPromise) this.clientPromise = buildMmaClient({ db: this.db });
    return this.clientPromise;
  }

  /** Whether a batch row id is currently registered (in-flight). */
  isRegistered(batchRowId: string): boolean {
    return this.inFlight.has(batchRowId);
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Register a freshly-dispatched (or rehydrated) batch. `createdAt` anchors the
   * 1-hour hard timeout. Schedules the first poll on the base interval.
   */
  register(b: {
    batchId: string;
    mmaBatchId: string;
    projectId: string | null;
    route: string;
    taskId: string | null;
    handler?: string | null;
    createdAt: Date;
  }): void {
    if (this.inFlight.has(b.batchId)) return;
    const entry: RegisteredBatch = { ...b, handler: b.handler ?? null, attempt: 0, timer: null };
    this.inFlight.set(b.batchId, entry);
    this.schedule(entry, POLL_BASE_INTERVAL_MS);
  }

  private deregister(batchRowId: string): void {
    const entry = this.inFlight.get(batchRowId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.inFlight.delete(batchRowId);
  }

  private schedule(entry: RegisteredBatch, delayMs: number): void {
    if (!this.timersEnabled) return;
    entry.timer = setTimeout(() => {
      void this.pollOnce(entry.batchId);
    }, delayMs);
    // Don't keep the process alive purely for polling.
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }

  /**
   * Poll one in-flight batch exactly once and apply the resulting transition.
   * Returns the outcome (deterministic-test surface). Re-schedules the next poll
   * for a still-in-flight batch.
   */
  async pollOnce(batchRowId: string): Promise<PollOutcome> {
    const entry = this.inFlight.get(batchRowId);
    if (!entry) return { kind: 'gone' };

    // Hard timeout precedes the poll: a batch already past 1h is force-failed.
    if (this.now() - entry.createdAt.getTime() > POLL_HARD_TIMEOUT_MS) {
      await this.markTimeout(entry);
      return { kind: 'timeout' };
    }

    let client: MmaClient;
    try {
      client = await this.client();
    } catch (err) {
      return this.handleTransient(entry, err);
    }

    let res: Awaited<ReturnType<MmaClient['poll']>>;
    try {
      res = await client.poll(entry.mmaBatchId);
    } catch (err) {
      return this.handleTransient(entry, err);
    }

    // Successful poll → reset the backoff attempt counter.
    entry.attempt = 0;

    if (res.state === 'not_found') {
      await this.markNotFound(entry);
      return { kind: 'terminal', state: { status: 'failed' as const, error: { code: 'task_not_found', message: `MMA task ${entry.mmaBatchId} no longer exists (404). The server may have restarted.` }, contextBlockId: null } };
    }

    if (res.state === 'pending') {
      await this.markRunning(entry, res.headline);
      this.schedule(entry, POLL_BASE_INTERVAL_MS);
      return { kind: 'pending', headline: res.headline };
    }

    const state = interpretTerminal(res.envelope);
    await this.markTerminal(entry, res.envelope, state);
    return { kind: 'terminal', state };
  }

  private handleTransient(entry: RegisteredBatch, err: unknown): PollOutcome {
    const attempt = entry.attempt;
    const delay = backoffMs(attempt, this.rand);
    entry.attempt = attempt + 1;
    logPoll({
      level: 'warn',
      event: 'poll.retry',
      projectId: entry.projectId ?? undefined,
      batchId: entry.mmaBatchId,
      attempt,
      backoffMs: delay,
      detail: errName(err),
    });
    logPoll({
      level: 'error',
      event: 'mma.call_error',
      projectId: entry.projectId ?? undefined,
      batchId: entry.mmaBatchId,
      detail: errName(err),
    });
    this.schedule(entry, delay);
    return { kind: 'transient', attempt, backoffMs: delay };
  }

  /** 202 headline → status='running' + a `task.progress` event. */
  private async markRunning(entry: RegisteredBatch, headline: string): Promise<void> {
    await this.db
      .update(mmaBatch)
      .set({ status: 'running' })
      .where(eq(mmaBatch.id, entry.batchId));
    if (entry.taskId && entry.projectId) {
      this.bus.publish(entry.projectId, {
        type: 'task.progress',
        taskId: entry.taskId,
        mmaBatchId: entry.batchId,
        headline,
        route: entry.route,
        status: 'running',
      });
    }
  }

  /** 200 terminal → persist result/status/terminal_at + usage columns, call handler, flip task, emit, deregister. */
  private async markTerminal(
    entry: RegisteredBatch,
    envelope: unknown,
    state: TerminalState,
  ): Promise<void> {
    const usage = extractUsageFields(envelope);
    let effectiveState = state;
    // Compare-and-set: only the poller that actually transitions the row out of dispatched/running
    // runs the terminal handler, emits, and notifies. Two pollers for the same batch (multi-instance
    // boot rehydrate, or a findInflight re-register racing an in-progress terminal) would otherwise
    // double-run the file-writing handler and double-push the failure notification.
    let transitioned = true;
    try {
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(mmaBatch)
          .set({
            status: state.status,
            result: envelope as object,
            terminalAt: new Date(),
            ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
            ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
            ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
            ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
            ...(usage.cacheTokens !== null && { cacheTokens: usage.cacheTokens }),
            ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
          })
          .where(and(eq(mmaBatch.id, entry.batchId), inArray(mmaBatch.status, ['dispatched', 'running'])))
          .returning({ id: mmaBatch.id });
        if (updated.length === 0) { transitioned = false; return; } // already terminal — another poller won

        if (entry.taskId && entry.projectId) {
          try {
            // markTerminal is the SOLE writer of this recorded-flip for a normal terminal, and a
            // discover fan-out can flip many tasks near-simultaneously — a lost flip strands the
            // task 'running' forever (synthesis only fires when ALL tasks are recorded). Raise the
            // CAS ceiling for this hot path, and log (don't silently swallow) if it still loses so
            // it's observable rather than a silent strand.
            await updateDetails(tx as unknown as Db, entry.projectId, (d) => {
              const task = d.stages.exploration.phases.discover.tasks.find((t) =>
                t.attempts.some((a) => a.batchId === entry.batchId));
              if (task) task.status = 'recorded';
              return d;
            }, 8);
          } catch (flipErr) {
            logPoll({ level: 'error', event: 'details.flip_conflict', batchId: entry.mmaBatchId, projectId: entry.projectId, detail: String(flipErr) });
          }
        }

        // Call the registered on-terminal handler (if any)
        if (state.status === 'done') {
          const [batchRow] = await tx
            .select({ handler: mmaBatch.handler, projectId: mmaBatch.projectId, request: mmaBatch.request, dispatchedBy: mmaBatch.dispatchedBy })
            .from(mmaBatch)
            .where(eq(mmaBatch.id, entry.batchId))
            .limit(1);
          if (batchRow?.handler) {
            // Await registration before lookup: the handlers self-register on async
            // import, so a lookup before they resolve returns undefined and the
            // terminal handler (the gating-state writer) silently never runs.
            await ensureHandlersRegistered();
            const handler = getHandler(batchRow.handler);
            if (handler) {
              await handler(tx as unknown as Db, {
                batchRowId: entry.batchId,
                projectId: batchRow.projectId ?? '',
                handler: batchRow.handler,
                request: batchRow.request,
                actorId: batchRow.dispatchedBy ?? null,
              }, envelope);
            }
          }
        }
      });
    } catch (handlerErr) {
      logPoll({
        level: 'error',
        event: 'handler.failed',
        batchId: entry.mmaBatchId,
        projectId: entry.projectId ?? undefined,
        detail: String(handlerErr),
      });
      await this.db
        .update(mmaBatch)
        .set({
          status: 'failed',
          result: { error: { message: String(handlerErr) } } as object,
          terminalAt: new Date(),
        })
        .where(eq(mmaBatch.id, entry.batchId));
      effectiveState = { status: 'failed', error: { code: 'handler_error', message: String(handlerErr) }, contextBlockId: null };
    }
    // Another poller already processed this terminal — skip the duplicate timeline/notification/emit,
    // just drop our tracking of it.
    if (!transitioned) { this.deregister(entry.batchId); return; }
    // Resolve the running timeline line AFTER the terminal transaction (which may
    // itself have mutated details via the handler) so it's a clean, isolated
    // update. Duration = wall-clock from dispatch. Best-effort.
    await appendBatchTerminalEvent(this.db, entry.projectId, entry.handler, entry.batchId, effectiveState.status, this.now() - entry.createdAt.getTime());

    // Record discover-task terminal row for taskId entries (FR-9/FR-10)
    if (entry.taskId && entry.projectId) {
      const [batchRow] = await this.db
        .select({ request: mmaBatch.request })
        .from(mmaBatch)
        .where(eq(mmaBatch.id, entry.batchId))
        .limit(1);
      const label = await buildDiscoverTerminalLabel(this.db, (batchRow?.request ?? {}) as Record<string, unknown>);
      await recordActivity({
        db: this.db,
        projectId: entry.projectId,
        stage: 'exploration',
        phase: 'discover',
        label,
        kind: effectiveState.status === 'failed' ? 'error' : 'done',
        actor: { id: FORGE_MEMBER_ID, name: 'Forge', tint: '#9a6b4f' },
        source: 'mma',
        durationMs: this.now() - entry.createdAt.getTime(),
        eventKey: `discover-task:${entry.batchId}`,
      });
    }

    this.emitTerminal(entry, effectiveState);
    this.deregister(entry.batchId);
  }

  /**
   * Settle the durable timeline + discover-task state for a terminal that did NOT
   * pass through `markTerminal`'s handler path (a 404 or the 1-hour hard timeout).
   * Without this, a tracked batch that dies via 404/timeout leaves its running
   * `project_activity` line unresolved forever and its owning discover task stuck
   * `running` in details — mirroring what `markTerminal` does on a normal terminal.
   * Best-effort: polling must never throw on settle.
   */
  private async settleAbandonedTerminal(entry: RegisteredBatch): Promise<void> {
    // Whole body is best-effort: a DB failure here must NEVER escape into the
    // caller (markNotFound / markTimeout), or the batch would never emit its
    // terminal SSE or deregister — leaking it in `inFlight` forever with a dead
    // timer. Swallow + log; the batch is still failed in the DB regardless.
    try {
      const durationMs = this.now() - entry.createdAt.getTime();
      // Flip the owning discover task to 'recorded' (it reached a terminal — failed).
      // Independently guarded: a details-flip failure must not block the activity
      // settle below (the two are unrelated writes).
      if (entry.taskId && entry.projectId) {
        try {
          await updateDetails(this.db, entry.projectId, (d) => {
            const task = d.stages.exploration.phases.discover.tasks.find((t) =>
              t.attempts.some((a) => a.batchId === entry.batchId));
            if (task) task.status = 'recorded';
            return d;
          });
        } catch { /* best-effort during poll */ }
      }
      // Resolve the running project_activity line for tracked handlers (no-op when
      // there is no running line, e.g. an untracked handler).
      await appendBatchTerminalEvent(this.db, entry.projectId, entry.handler, entry.batchId, 'failed', durationMs);
      // Record the discover-task terminal row (error) for taskId entries (FR-9/FR-10).
      if (entry.taskId && entry.projectId) {
        const [batchRow] = await this.db
          .select({ request: mmaBatch.request })
          .from(mmaBatch)
          .where(eq(mmaBatch.id, entry.batchId))
          .limit(1);
        const label = await buildDiscoverTerminalLabel(this.db, (batchRow?.request ?? {}) as Record<string, unknown>);
        await recordActivity({
          db: this.db,
          projectId: entry.projectId,
          stage: 'exploration',
          phase: 'discover',
          label,
          kind: 'error',
          actor: { id: FORGE_MEMBER_ID, name: 'Forge', tint: '#9a6b4f' },
          source: 'mma',
          durationMs,
          eventKey: `discover-task:${entry.batchId}`,
        });
      }
    } catch (err) {
      logPoll({
        level: 'error',
        event: 'settle.failed',
        projectId: entry.projectId ?? undefined,
        batchId: entry.mmaBatchId,
        taskId: entry.taskId ?? undefined,
        detail: String(err),
      });
    }
  }

  /** MMA returned 404 — task no longer exists (server restarted). Fail immediately. */
  private async markNotFound(entry: RegisteredBatch): Promise<void> {
    const state: TerminalState = {
      status: 'failed',
      error: { code: 'task_not_found', message: `MMA task ${entry.mmaBatchId} no longer exists (404). The server may have restarted.` },
      contextBlockId: null,
    };
    await this.db
      .update(mmaBatch)
      .set({
        status: 'failed',
        result: { error: state.error } as object,
        terminalAt: new Date(),
      })
      .where(eq(mmaBatch.id, entry.batchId));
    await this.settleAbandonedTerminal(entry);
    logPoll({
      level: 'error',
      event: 'poll.not_found',
      projectId: entry.projectId ?? undefined,
      batchId: entry.mmaBatchId,
      taskId: entry.taskId ?? undefined,
      detail: 'MMA returned 404 — task lost after server restart',
    });
    this.emitTerminal(entry, state);
    this.deregister(entry.batchId);
  }

  /** 1-hour hard timeout → force status='failed' with the synthesized error. */
  private async markTimeout(entry: RegisteredBatch): Promise<void> {
    const state: TerminalState = {
      status: 'failed',
      error: { ...FORGE_POLL_TIMEOUT_ERROR },
      contextBlockId: null,
    };
    await this.db.transaction(async (tx) => {
      await tx
        .update(mmaBatch)
        .set({
          status: 'failed',
          result: { error: { ...FORGE_POLL_TIMEOUT_ERROR } } as object,
          terminalAt: new Date(),
        })
        .where(eq(mmaBatch.id, entry.batchId));
    });
    await this.settleAbandonedTerminal(entry);
    logPoll({
      level: 'error',
      event: 'poll.timeout',
      projectId: entry.projectId ?? undefined,
      batchId: entry.mmaBatchId,
      taskId: entry.taskId ?? undefined,
    });
    this.emitTerminal(entry, state);
    this.deregister(entry.batchId);
  }

  private emitTerminal(entry: RegisteredBatch, state: TerminalState): void {
    logPoll({
      level: state.status === 'failed' ? 'warn' : 'info',
      event: state.status === 'failed' ? 'task.failed' : 'task.done',
      projectId: entry.projectId ?? undefined,
      batchId: entry.mmaBatchId,
      taskId: entry.taskId ?? undefined,
    });
    // Existing explore-specific events (backward compat)
    if (entry.taskId && entry.projectId) {
      this.bus.publish(
        entry.projectId,
        terminalEvent({
          taskId: entry.taskId,
          mmaBatchId: entry.batchId,
          route: entry.route,
          state,
        }),
      );
    }
    // Universal dispatch events for handler-based batches
    if (entry.handler && entry.projectId) {
      this.bus.publish(entry.projectId, state.status === 'failed'
        ? { type: 'dispatch.failed', batchId: entry.batchId, handler: entry.handler, error: state.error?.message ?? 'Unknown error' }
        : { type: 'dispatch.done', batchId: entry.batchId, handler: entry.handler },
      );
    }
    // Persist failure notifications to DB
    if (state.status === 'failed' && entry.handler) {
      void this.insertFailureNotification(entry).catch(() => {});
    }
  }

  private async insertFailureNotification(entry: RegisteredBatch): Promise<void> {
    const { pushDispatchFailure } = await import('@/collab/notification-store');
    const { project } = await import('@/db/schema/projects');
    const { eq } = await import('drizzle-orm');
    if (!entry.projectId) return;
    const [proj] = await this.db
      .select({ name: project.name })
      .from(project)
      .where(eq(project.id, entry.projectId))
      .limit(1);
    await pushDispatchFailure({
      projectId: entry.projectId ?? undefined,
      projectName: proj?.name ?? '',
      handler: entry.handler!,
      batchId: entry.batchId,
    }, this.db);
  }

  /**
   * Rehydrate in-flight batches from the DB on server boot (`status IN
   * ('dispatched','running')`). A batch already past the 1-hour deadline is
   * failed on its first poll (timeout is measured from `created_at`).
   */
  async rehydrate(): Promise<number> {
    const rows = await this.db
      .select({
        id: mmaBatch.id,
        batchId: mmaBatch.batchId,
        projectId: mmaBatch.projectId,
        route: mmaBatch.route,
        handler: mmaBatch.handler,
        createdAt: mmaBatch.createdAt,
      })
      .from(mmaBatch)
      .where(inArray(mmaBatch.status, ['dispatched', 'running']));

    if (rows.length === 0) return 0;

    const taskByBatch = new Map<string, string>();

    let n = 0;
    for (const r of rows) {
      if (!r.batchId) continue; // never got a batchId — nothing to poll
      if (!r.projectId) continue; // loop dispatches are project-less; not polled by the project SSE manager
      this.register({
        batchId: r.id,
        mmaBatchId: r.batchId,
        projectId: r.projectId,
        route: r.route,
        taskId: taskByBatch.get(r.id) ?? null,
        handler: r.handler,
        createdAt: r.createdAt,
      });
      n += 1;
    }
    logPoll({ level: 'info', event: 'rehydrate', detail: `${n} batch(es)` });
    return n;
  }

  /** Stop all timers (test teardown). */
  shutdown(): void {
    for (const entry of this.inFlight.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.inFlight.clear();
  }
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}

/** Process-wide singleton — auto-rehydrates on first creation. */
let singleton: PollManager | null = null;
export function getPollManager(): PollManager {
  if (!singleton) {
    singleton = new PollManager();
    void singleton.rehydrate().catch(() => {});
  }
  return singleton;
}
