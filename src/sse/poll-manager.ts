import { eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { explorationTask } from '@/db/schema/exploration';
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
 *  - a batch with no terminal envelope >15min after `created_at` is force-failed
 *    (`forge_poll_timeout`) — the only non-MMA-originated failure transition.
 *  - rehydrates in-flight batches (`status IN ('dispatched','running')`) on boot.
 */

export const POLL_BASE_INTERVAL_MS = 2_000;
export const POLL_BACKOFF_CAP_MS = 30_000;
export const POLL_HARD_TIMEOUT_MS = 30 * 60_000;
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
  projectId: string;
  route: string;
  taskId: string | null;
  handler: string | null; // on-terminal handler key (dispatch system)
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
    ensureHandlersRegistered();
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
   * 15-min hard timeout. Schedules the first poll on the base interval.
   */
  register(b: {
    batchId: string;
    mmaBatchId: string;
    projectId: string;
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

    // Hard timeout precedes the poll: a batch already past 15min is force-failed.
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
      projectId: entry.projectId,
      batchId: entry.mmaBatchId,
      attempt,
      backoffMs: delay,
      detail: errName(err),
    });
    logPoll({
      level: 'error',
      event: 'mma.call_error',
      projectId: entry.projectId,
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
    if (entry.taskId) {
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
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(mmaBatch)
          .set({
            status: state.status,
            result: envelope as object,
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
          .where(eq(mmaBatch.id, entry.batchId));

        if (entry.taskId) {
          await tx
            .update(explorationTask)
            .set({ status: 'recorded' })
            .where(eq(explorationTask.id, entry.taskId));
        }

        // Call the registered on-terminal handler (if any)
        if (state.status === 'done') {
          const [batchRow] = await tx
            .select({ handler: mmaBatch.handler, projectId: mmaBatch.projectId, request: mmaBatch.request, dispatchedBy: mmaBatch.dispatchedBy })
            .from(mmaBatch)
            .where(eq(mmaBatch.id, entry.batchId))
            .limit(1);
          if (batchRow?.handler) {
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
        projectId: entry.projectId,
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
    this.emitTerminal(entry, effectiveState);
    this.deregister(entry.batchId);
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
    if (entry.taskId) {
      await this.db
        .update(explorationTask)
        .set({ status: 'recorded' })
        .where(eq(explorationTask.id, entry.taskId));
    }
    logPoll({
      level: 'error',
      event: 'poll.not_found',
      projectId: entry.projectId,
      batchId: entry.mmaBatchId,
      taskId: entry.taskId ?? undefined,
      detail: 'MMA returned 404 — task lost after server restart',
    });
    this.emitTerminal(entry, state);
    this.deregister(entry.batchId);
  }

  /** 15-min hard timeout → force status='failed' with the synthesized error. */
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
      if (entry.taskId) {
        await tx
          .update(explorationTask)
          .set({ status: 'recorded' })
          .where(eq(explorationTask.id, entry.taskId));
      }
    });
    logPoll({
      level: 'error',
      event: 'poll.timeout',
      projectId: entry.projectId,
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
      projectId: entry.projectId,
      batchId: entry.mmaBatchId,
      taskId: entry.taskId ?? undefined,
    });
    // Existing explore-specific events (backward compat)
    if (entry.taskId) {
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
    if (entry.handler) {
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
    const [proj] = await this.db
      .select({ name: project.name })
      .from(project)
      .where(eq(project.id, entry.projectId))
      .limit(1);
    await pushDispatchFailure({
      projectId: entry.projectId,
      projectName: proj?.name ?? '',
      handler: entry.handler!,
      batchId: entry.batchId,
    }, this.db);
  }

  /**
   * Rehydrate in-flight batches from the DB on server boot (`status IN
   * ('dispatched','running')`). A batch already past the 15-min deadline is
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

    // Find the owning task per batch (for the SSE link).
    const taskRows = await this.db
      .select({ id: explorationTask.id, mmaBatchId: explorationTask.mmaBatchId })
      .from(explorationTask)
      .where(
        inArray(
          explorationTask.mmaBatchId,
          rows.map((r) => r.id),
        ),
      );
    const taskByBatch = new Map(taskRows.map((t) => [t.mmaBatchId!, t.id]));

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
