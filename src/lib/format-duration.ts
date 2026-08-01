/**
 * Duration rendering — one home for every elapsed-time format in the product.
 *
 * These were previously inlined per component, which produced verbatim copies:
 * `formatDur` existed character-for-character in both `SummaryPhase` and
 * `AutomationOverlay` (the former's comment even said "matching the live overlay"),
 * and `formatElapsed` existed twice more, identical but for local variable names.
 * A copy is how two surfaces silently drift apart.
 *
 * The three formats are genuinely different products, not stylistic variants — each
 * exists because a specific surface needs that precision:
 *
 * | function                  | example            | used for                        |
 * |---------------------------|--------------------|---------------------------------|
 * | `formatElapsed`           | `45s`, `2m 3s`     | a live ticking counter          |
 * | `formatActivityDuration`  | `0.4s`, `2m 3s`    | one finished activity row       |
 * | `formatDurationHm`        | `20m`, `1h 35m`    | a whole stage or project total  |
 *
 * NOT here: `usage/format.ts :: formatDuration`. It is a fourth contract, not a
 * duplicate — it accepts `null` (rendering the `—` the usage tables use for a missing
 * value) and compresses hours to a single decimal (`1.6h`) because those tables are
 * dense and column width matters more than the exact minute. It stays with the other
 * `usage/format` helpers its callers import alongside it.
 */

/**
 * Whole-second elapsed time for a LIVE counter: `45s`, `2m 3s`.
 *
 * Floors to whole seconds — a ticking display must never show a fractional digit
 * flickering, and must never round up to a second that has not elapsed yet.
 */
export function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

/**
 * Compact duration for ONE finished activity: `0.4s`, `12.6s`, `2m 3s`.
 *
 * Keeps a tenth of a second below the minute mark because most activities finish in
 * under ten seconds, where whole seconds would flatten every row to `0s`/`1s`. The
 * `Math.max(0, …)` guards a negative input (clock skew between dispatch and
 * completion) from rendering as `-0.1s`.
 */
export function formatActivityDuration(ms: number): string {
  if (ms < 950) return `${Math.max(0, Math.round(ms / 100) / 10)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/**
 * Coarse duration for a whole stage or project: `500ms`, `45s`, `20m`, `1h 35m`.
 *
 * Named `…Hm` rather than `formatDuration` on purpose: an unqualified `formatDuration`
 * already exists in `usage/format.ts` with a DIFFERENT output for the same input
 * (`1.6h` vs `1h 35m`), and two same-named exports differing only by import path is a
 * bug waiting to be imported.
 */
export function formatDurationHm(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  // Floor, not round: 95 min is 1h 35m, not 2h 35m (rounding would carry the hour AND
  // still show the 35-minute remainder).
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
