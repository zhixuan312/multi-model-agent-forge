/**
 * How long a dispatched MMA task may stay in flight before Forge stops waiting.
 *
 * A module of its own, imported by everyone who needs the number, because it USED to live in
 * `poll-manager.ts` while `envelope.ts` read it to build `FORGE_POLL_TIMEOUT_ERROR` — and
 * `poll-manager` imports `envelope`. That cycle is invisible in dev and in tests, and fails
 * the production build outright when the bundler happens to evaluate `envelope` first:
 *
 *     ReferenceError: Cannot access 'k' before initialization
 *       at Module.POLL_HARD_TIMEOUT_MS (.next/server/chunks/src_sse_….js)
 *     > Failed to collect page data for /api/projects/[id]/pending-handlers
 *
 * The derivation that caused it was right — the timeout message used to say "within 15m" long
 * after the ceiling moved to an hour, and a second hardcoded duration is how that drift
 * starts. Deriving from a shared leaf module keeps the single source without the cycle.
 */
export const POLL_HARD_TIMEOUT_MS = 60 * 60_000;
