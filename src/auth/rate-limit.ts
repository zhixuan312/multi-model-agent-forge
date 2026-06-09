import { LOGIN_RATELIMIT_MAX, LOGIN_RATELIMIT_WINDOW_MS } from '@/auth/config';

/**
 * Failed-login rate limiter — two INDEPENDENT in-memory counters per attempt
 * (Spec 1 F1/F13): one keyed on the lower-cased username, one on the client IP.
 * An attempt is throttled when EITHER counter is at the cap.
 *
 * Two independent counters (not one `username+IP` composite) so an attacker
 * rotating IPs can't evade per-account lockout, and a NAT'd user can't evade
 * per-IP lockout. A successful login resets BOTH of that attempt's counters.
 *
 * Single-instance, in-memory (no DB table — F6); the Redis-backed limiter
 * arrives with Redis in Spec 5. The window is fixed-per-key: a counter resets
 * once `LOGIN_RATELIMIT_WINDOW_MS` has elapsed since its window started.
 */

interface Counter {
  count: number;
  windowStart: number;
}

export interface AttemptKeys {
  username: string;
  ip: string;
}

export interface RateLimitVerdict {
  throttled: boolean;
  /** Seconds until the offending window resets (only meaningful when throttled). */
  retryAfterSeconds: number;
  /** Which key tripped — for the operational log's `rateLimitKey`. */
  key?: string;
}

function normUser(username: string): string {
  return `u:${username.trim().toLowerCase()}`;
}
function normIp(ip: string): string {
  return `ip:${ip.trim()}`;
}

export class LoginRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Return (and prune) the live counter for a key, or undefined if its window
   *  has elapsed (treated as reset). */
  private live(key: string): Counter | undefined {
    const c = this.counters.get(key);
    if (!c) return undefined;
    if (this.now() - c.windowStart >= LOGIN_RATELIMIT_WINDOW_MS) {
      this.counters.delete(key);
      return undefined;
    }
    return c;
  }

  /** Evaluate whether this attempt should be throttled. Does NOT mutate state. */
  check(keys: AttemptKeys): RateLimitVerdict {
    const candidates: Array<{ key: string; counter: Counter | undefined }> = [
      { key: normUser(keys.username), counter: this.live(normUser(keys.username)) },
      { key: normIp(keys.ip), counter: this.live(normIp(keys.ip)) },
    ];
    for (const { key, counter } of candidates) {
      if (counter && counter.count >= LOGIN_RATELIMIT_MAX) {
        const elapsed = this.now() - counter.windowStart;
        const retryAfterSeconds = Math.max(1, Math.ceil((LOGIN_RATELIMIT_WINDOW_MS - elapsed) / 1000));
        return { throttled: true, retryAfterSeconds, key };
      }
    }
    return { throttled: false, retryAfterSeconds: 0 };
  }

  /** Increment both counters after a failed login. */
  recordFailure(keys: AttemptKeys): void {
    this.bump(normUser(keys.username));
    this.bump(normIp(keys.ip));
  }

  private bump(key: string): void {
    const c = this.live(key);
    if (!c) {
      this.counters.set(key, { count: 1, windowStart: this.now() });
    } else {
      c.count += 1;
    }
  }

  /** A successful login clears BOTH of this attempt's counters. */
  recordSuccess(keys: AttemptKeys): void {
    this.counters.delete(normUser(keys.username));
    this.counters.delete(normIp(keys.ip));
  }
}

/** Process-wide shared limiter (single-instance deploy). */
export const loginRateLimiter = new LoginRateLimiter();
