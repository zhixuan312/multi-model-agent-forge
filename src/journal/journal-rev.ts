/**
 * Journal freshness marker for recall pins (Spec: journal recall pins).
 *
 * A pin caches a recall answer; the journal it was synthesized from keeps growing
 * (create/refine/supersede/merge each append a `log.md` entry). The marker is the
 * COUNT of `log.md` entries — a monotonically-increasing integer — rather than a
 * timestamp, because `log.md` timestamps may carry mixed UTC offsets (`…Z` vs
 * `…+08:00`) so string/lexical comparison is not chronological. Integer comparison
 * is the robust "any write since" signal.
 */
import { readLog } from '@/journal/store-reader';

/**
 * The journal's current freshness marker: the number of `log.md` entries at the
 * workspace root. A single local file read (no DB, no engine). Missing/empty log
 * → 0. An EACCES (present-but-unreadable) journal propagates from `readLog` so the
 * caller renders its existing "unreadable" state rather than guessing a count.
 */
export async function currentJournalLogCount(root: string): Promise<number> {
  return (await readLog(root)).length;
}

/** A pin is stale once the journal has had writes since its answer was computed. */
export function isPinStale(pinLogCount: number, currentLogCount: number): boolean {
  return pinLogCount < currentLogCount;
}
