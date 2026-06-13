/**
 * Auth named constants — the load-bearing numeric/string decisions from Spec 1
 * ("Named constants"). Each has a default and an env override; these are
 * *decided* values, not examples (do not tighten without re-measuring — see
 * the spec's rationale block).
 *
 * Durations like `30d` / `7d` / `15min` are parsed to milliseconds.
 */

/** Parse a duration string (`30d`, `7d`, `15min`, `900s`, `500ms`) or a bare
 *  number (interpreted as milliseconds) to milliseconds. */
export function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (value === undefined || value.trim() === '') return fallbackMs;
  const raw = value.trim();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|min|m|h|d)?$/i.exec(raw);
  if (!m) throw new Error(`Invalid duration: ${value}`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const mult: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return Math.round(n * mult[unit]);
}

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Expected a positive integer, got: ${value}`);
  return n;
}

/** Session absolute max lifetime (default 30 days). */
export const SESSION_ABSOLUTE_TTL_MS = parseDurationMs(process.env.SESSION_ABSOLUTE_TTL, 30 * 86_400_000);
/** Session sliding idle window (default 7 days). */
export const SESSION_IDLE_TTL_MS = parseDurationMs(process.env.SESSION_IDLE_TTL, 7 * 86_400_000);
/** Minimum password length on create / reset / change (default 8). */
export const PASSWORD_MIN_LENGTH = intEnv(process.env.PASSWORD_MIN_LENGTH, 8);
/** Failed logins per key per window before throttle (default 10). */
export const LOGIN_RATELIMIT_MAX = intEnv(process.env.LOGIN_RATELIMIT_MAX, 10);
/** Sliding window for the rate limit (default 15 min). */
export const LOGIN_RATELIMIT_WINDOW_MS = parseDurationMs(process.env.LOGIN_RATELIMIT_WINDOW, 15 * 60_000);
/** argon2id memoryCost in KiB (default 19456 = 19 MiB, OWASP floor). */
export const ARGON2_MEMORY_KIB = intEnv(process.env.ARGON2_MEMORY_KIB, 19_456);
/** argon2id timeCost / iterations (default 2). */
export const ARGON2_ITERATIONS = intEnv(process.env.ARGON2_ITERATIONS, 2);
/** argon2id parallelism (default 1). */
export const ARGON2_PARALLELISM = intEnv(process.env.ARGON2_PARALLELISM, 1);
/** Session cookie SameSite mode (pinned to Lax — the CSRF control for Spec 1). */
export const COOKIE_SAMESITE = 'lax' as const;
/** Session cookie name. */
export const SESSION_COOKIE_NAME = 'forge_session';
