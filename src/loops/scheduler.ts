import { eq, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { loop, loopRun } from '@/db/schema/loop';
import { nextRuns } from '@/loops/cron';
import { startLoopRun } from '@/loops/run-now';
import { logEvent } from '@/observability/log-event';
import { errMessage } from '@/lib/err';

/**
 * Loops scheduler (spec §5). The `loop-worker` ticks ~once/minute and fires due,
 * enabled loops. `isDue` is the pure core; `tickScheduler` is the per-tick pass.
 * Missed occurrences (machine off) are SKIPPED, not back-filled (no stampede),
 * and a loop with a run already in flight is skipped (one in-flight per loop) — unless
 * that run is old enough to be provably abandoned, which is failed rather than believed
 * (see `STALE_RUN_MS`).
 */

/** Default catch-up window: a scheduled occurrence older than this is treated as missed. */
export const DUE_WINDOW_MS = 90_000;

/**
 * How long a `running` loop_run row may sit before the scheduler stops believing it.
 *
 * A run row is written `running` before the work starts and only ever leaves that state
 * from inside `runLoopForRepo`'s own `finish()`. Kill the process mid-run — a container
 * restart, a deploy, an OOM — and the row stays `running` forever. The in-flight check
 * below skips a loop whose latest run is `running`, so that loop never fires again. No
 * error, no alert: a maintenance loop simply stops, and the run history shows it as still
 * going months later.
 *
 * `ops_mma_batch` already has this exact reaper (`findInflight`'s `dispatch_orphaned`
 * path); loop runs had none. Six hours is far past any real maintenance run — the engine's
 * own poll ceiling for a single batch is one hour — while being long enough that a genuinely
 * slow multi-repo fire is never cut short.
 */
export const STALE_RUN_MS = 6 * 60 * 60_000;

/**
 * True iff the loop's most recent scheduled occurrence (≤ now) is recent (within
 * `windowMs`) AND newer than the last time we fired it.
 */
export function isDue(cron: string, lastFiredAt: Date | null, now: Date, windowMs = DUE_WINDOW_MS): boolean {
  // The first scheduled occurrence strictly after (now - window): if it lands at
  // or before `now`, there's a fresh occurrence in the recent window.
  //
  // Via `nextRuns`, not a third `new Cron(...)`: the timezone is part of what a cron
  // expression MEANS here, and wiring it separately at each construction site is how one
  // of them ends up interpreting the schedule in a different zone from the preview the
  // user was shown.
  const windowStart = new Date(now.getTime() - windowMs);
  const [occ] = nextRuns(cron, 1, windowStart);
  if (!occ) return false;
  if (occ.getTime() > now.getTime()) return false; // next occurrence is in the future → nothing due now (missed = skipped)
  if (lastFiredAt && occ.getTime() <= lastFiredAt.getTime()) return false; // already fired this occurrence
  return true;
}

export interface TickDeps {
  db?: Db;
  now?: () => Date;
  windowMs?: number;
  /** Override the abandoned-run threshold (tests). */
  staleRunMs?: number;
  starter?: typeof startLoopRun;
}

/** One scheduler pass: fire every due, enabled, not-in-flight loop. Returns fired loop IDs. */
export async function tickScheduler(deps: TickDeps = {}): Promise<{ fired: string[] }> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? (() => new Date()))();
  const starter = deps.starter ?? startLoopRun;

  const loops = await db.select().from(loop).where(eq(loop.enabled, true));
  const fired: string[] = [];
  for (const l of loops) {
    // Cheap filters BEFORE the per-loop query: an event-triggered loop is never fired
    // here, so reading its latest run every tick is a query for an answer we discard.
    if (l.mode !== 'recurring') continue;
    if (!l.cron) continue;
    const [latest] = await db
      .select({ id: loopRun.id, startedAt: loopRun.startedAt, status: loopRun.status })
      .from(loopRun)
      .where(eq(loopRun.loopId, l.id))
      .orderBy(desc(loopRun.startedAt))
      .limit(1);
    if (latest?.status === 'running') {
      const age = now.getTime() - latest.startedAt.getTime();
      if (age < (deps.staleRunMs ?? STALE_RUN_MS)) continue;
      // Provably dead: no run reaches this age with a live process behind it. Fail it so
      // the row stops lying in the history AND stops wedging the schedule.
      await db
        .update(loopRun)
        .set({
          status: 'failed',
          finishedAt: now,
          journalEntries: [{ tag: 'missed', text: 'run_abandoned: no process finished this run — the server likely restarted mid-run' }],
        })
        .where(eq(loopRun.id, latest.id));
    }
    if (isDue(l.cron, latest?.startedAt ?? null, now, deps.windowMs)) {
      await starter(l.id, 'schedule', { db });
      fired.push(l.id);
    }
  }
  return { fired };
}

/** Start the worker loop (the bootstrap). Returns a stop fn. Not unit-tested — it just ticks. */
export function startLoopWorker(intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await tickScheduler();
    } catch (e) {
      // `(e as Error).message` on a Drizzle failure is "Failed query: <the whole SELECT>" —
      // it named the statement, the columns and the parameter, and omitted the reason,
      // once a minute forever. `errMessage` walks the `cause` chain, which is where the
      // ECONNREFUSED / 42P01 / password-auth actually lives.
      //
      // Through `logEvent`, not `console.error`: raw console logging is the second,
      // sink-less log shape that `instrumentation.ts` records retiring — no `ts`, no
      // `level`, and unobservable from a test. This call site was left behind.
      logEvent({ event: 'loops.tick_failed', level: 'error', detail: errMessage(e) });
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  void tick(); // fire one immediately on start
  return () => clearInterval(handle);
}
