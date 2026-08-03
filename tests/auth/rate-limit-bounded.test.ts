// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '@/auth/rate-limit';
import { LOGIN_RATELIMIT_WINDOW_MS } from '@/auth/config';

/**
 * The counter map only pruned a key when THAT key was looked up again, so entries for
 * usernames and IPs never seen again stayed forever. The login endpoint takes an
 * arbitrary username from an unauthenticated caller, so an attacker rotating usernames
 * (or a botnet rotating IPs) grows the map without bound — a slow memory exhaustion
 * reachable by anyone who can reach /login.
 */
describe('the failed-login counter map stays bounded', () => {
  /** How many distinct keys the limiter is holding. */
  const size = (rl: LoginRateLimiter) =>
    (rl as unknown as { counters: Map<string, unknown> }).counters.size;

  it('does not grow without bound across expired windows', () => {
    let now = 0;
    const rl = new LoginRateLimiter(() => now);

    // 5,000 distinct attackers, each one window apart so every entry expires.
    for (let i = 0; i < 5_000; i++) {
      rl.recordFailure({ username: `user${i}`, ip: `10.0.0.${i % 255}` });
      now += LOGIN_RATELIMIT_WINDOW_MS + 1;
    }

    expect(size(rl), 'expired counters are never reclaimed').toBeLessThan(1_000);
  });

  it('still throttles a live attacker after the sweep', () => {
    let now = 0;
    const rl = new LoginRateLimiter(() => now);
    for (let i = 0; i < 3_000; i++) {
      rl.recordFailure({ username: `noise${i}`, ip: `10.1.0.${i % 255}` });
      now += LOGIN_RATELIMIT_WINDOW_MS + 1;
    }
    // A real attacker, all within one window.
    for (let i = 0; i < 20; i++) rl.recordFailure({ username: 'victim', ip: '9.9.9.9' });
    expect(rl.check({ username: 'victim', ip: '9.9.9.9' }).throttled).toBe(true);
  });

  it('keeps counters that are still inside their window', () => {
    let now = 0;
    const rl = new LoginRateLimiter(() => now);
    for (let i = 0; i < 50; i++) rl.recordFailure({ username: `live${i}`, ip: `8.8.8.${i}` });
    now += 1; // no window has elapsed
    expect(size(rl)).toBe(100); // 50 usernames + 50 ips
  });
});
