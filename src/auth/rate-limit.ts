import { LOGIN_RATELIMIT_MAX, LOGIN_RATELIMIT_WINDOW_MS } from '@/auth/config';

/**
 * Failed-login rate limiter — two INDEPENDENT in-memory counters per attempt
 * (Spec 1 F1/F13): one keyed on the lower-cased username, one on the client IP.
 * An attempt is throttled when EITHER counter is at the cap.
 *
 * Two independent counters (not one `username+IP` composite) so an attacker
 * rotating IPs can't evade per-account lockout, and a NAT'd user can't evade
 * per-IP lockout.
 *
 * A successful login resets the USERNAME counter only. It used to reset both, which
 * handed the per-IP half to anyone holding one valid credential: fail nine times across
 * nine other usernames, log in as yourself, and the IP counter is clear again — repeat
 * without limit. Per-account lockout still held (the victims' own counters are untouched),
 * but per-IP is the counter that bounds TOTAL failure volume from one host, which is
 * exactly what password spraying across many usernames looks like.
 *
 * The cost is a shared-NAT office: ten wrong passwords in fifteen minutes now throttles
 * that address until the window elapses, with no way to clear it early. That is what a
 * per-IP limit means, and `LOGIN_RATELIMIT_MAX` / `LOGIN_RATELIMIT_WINDOW` are env knobs
 * for a deployment that needs a wider one.
 *
 * Single-instance, in-memory (no DB table — F6); the Redis-backed limiter
 * arrives with Redis in Spec 5. The window is fixed-per-key: a counter resets
 * once `LOGIN_RATELIMIT_WINDOW_MS` has elapsed since its window started.
 *
 * The map is BOUNDED by a sweep of expired counters (see `SWEEP_THRESHOLD`) — without
 * one, an unauthenticated caller rotating usernames grows it indefinitely.
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

/**
 * Prune expired counters once the map passes this size. A counter was only reclaimed when
 * ITS OWN key was looked up again, so entries for usernames and IPs never seen again
 * stayed forever — and `/login` takes an arbitrary username from an unauthenticated
 * caller, so rotating usernames (or a botnet rotating IPs) grew the map without bound.
 *
 * Comfortably above any legitimate concurrent-failure population, so the sweep is rare;
 * it only ever removes counters whose window has already elapsed, which are exactly the
 * ones `live()` would have discarded on next touch.
 */
const SWEEP_THRESHOLD = 1_000;

export class LoginRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Drop every counter whose window has elapsed. O(n), run only past the threshold. */
  private sweep(): void {
    const cutoff = this.now() - LOGIN_RATELIMIT_WINDOW_MS;
    for (const [key, counter] of this.counters) {
      if (counter.windowStart <= cutoff) this.counters.delete(key);
    }
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
      if (this.counters.size >= SWEEP_THRESHOLD) this.sweep();
      this.counters.set(key, { count: 1, windowStart: this.now() });
    } else {
      c.count += 1;
    }
  }

  /**
   * A successful login clears this USERNAME's counter. The IP counter is deliberately
   * left alone — see the module docstring; clearing it makes the per-IP limit resettable
   * on demand by anyone who can log in at all.
   */
  recordSuccess(keys: AttemptKeys): void {
    this.counters.delete(normUser(keys.username));
  }
}

/** Process-wide shared limiter (single-instance deploy). */
export const loginRateLimiter = new LoginRateLimiter();
