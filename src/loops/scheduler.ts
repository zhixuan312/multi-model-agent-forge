import { Cron } from 'croner';
import { eq, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { loop, loopRun } from '@/db/schema/loop';
import { isValidCron, LOOP_TIMEZONE } from '@/loops/cron';
import { startLoopRun } from '@/loops/run-now';

/**
 * Loops scheduler (spec §5). The `loop-worker` ticks ~once/minute and fires due,
 * enabled loops. `isDue` is the pure core; `tickScheduler` is the per-tick pass.
 * Missed occurrences (machine off) are SKIPPED, not back-filled (no stampede),
 * and a loop with a run already in flight is skipped (one in-flight per loop).
 */

/** Default catch-up window: a scheduled occurrence older than this is treated as missed. */
export const DUE_WINDOW_MS = 90_000;

/**
 * True iff the loop's most recent scheduled occurrence (≤ now) is recent (within
 * `windowMs`) AND newer than the last time we fired it.
 */
export function isDue(cron: string, lastFiredAt: Date | null, now: Date, windowMs = DUE_WINDOW_MS): boolean {
  if (!isValidCron(cron)) return false;
  // The first scheduled occurrence strictly after (now - window): if it lands at
  // or before `now`, there's a fresh occurrence in the recent window.
  const windowStart = new Date(now.getTime() - windowMs);
  const occ = new Cron(cron.trim(), { timezone: LOOP_TIMEZONE }).nextRun(windowStart);
  if (!occ) return false;
  if (occ.getTime() > now.getTime()) return false; // next occurrence is in the future → nothing due now (missed = skipped)
  if (lastFiredAt && occ.getTime() <= lastFiredAt.getTime()) return false; // already fired this occurrence
  return true;
}

export interface TickDeps {
  db?: Db;
  now?: () => Date;
  windowMs?: number;
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
    const [latest] = await db
      .select({ startedAt: loopRun.startedAt, status: loopRun.status })
      .from(loopRun)
      .where(eq(loopRun.loopId, l.id))
      .orderBy(desc(loopRun.startedAt))
      .limit(1);
    if (l.mode !== 'recurring') continue;
    if (!l.cron) continue;
    if (latest?.status === 'running') continue;
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
      console.error('[loops] scheduler tick failed:', (e as Error)?.message);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  void tick(); // fire one immediately on start
  return () => clearInterval(handle);
}
