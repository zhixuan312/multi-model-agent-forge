// @vitest-environment node
import { LoginRateLimiter } from '@/auth/rate-limit';
import { LOGIN_RATELIMIT_MAX, LOGIN_RATELIMIT_WINDOW_MS } from '@/auth/config';

describe('LoginRateLimiter — two independent sliding-window counters', () => {
  it('does not throttle below the cap', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX - 1; i++) {
      rl.recordFailure({ username: 'alice', ip: '1.1.1.1' });
    }
    const v = rl.check({ username: 'alice', ip: '1.1.1.1' });
    expect(v.throttled).toBe(false);
  });

  it('throttles once a counter reaches the cap (per-username)', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: 'alice', ip: `9.9.9.${i}` }); // vary IP so only username trips
    }
    const v = rl.check({ username: 'alice', ip: '8.8.8.8' });
    expect(v.throttled).toBe(true);
    expect(v.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('per-IP counter trips independently of username (one IP, many usernames)', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: `user${i}`, ip: '5.5.5.5' }); // vary username so only IP trips
    }
    // a brand-new username from the same flooded IP is throttled
    const v = rl.check({ username: 'fresh-user', ip: '5.5.5.5' });
    expect(v.throttled).toBe(true);
  });

  it('per-username counter trips independently of IP (one username, many IPs)', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: 'bob', ip: `7.7.7.${i}` });
    }
    const v = rl.check({ username: 'bob', ip: '6.6.6.6' });
    expect(v.throttled).toBe(true);
  });

  it('username matching is case-insensitive', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: 'Alice', ip: `2.2.2.${i}` });
    }
    expect(rl.check({ username: 'alice', ip: '3.3.3.3' }).throttled).toBe(true);
  });

  it('a successful login resets BOTH of that attempt\'s counters', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: 'carol', ip: '4.4.4.4' });
    }
    expect(rl.check({ username: 'carol', ip: '4.4.4.4' }).throttled).toBe(true);
    rl.recordSuccess({ username: 'carol', ip: '4.4.4.4' });
    expect(rl.check({ username: 'carol', ip: '4.4.4.4' }).throttled).toBe(false);
  });

  it('the window resets after LOGIN_RATELIMIT_WINDOW_MS (clock injected)', () => {
    let now = 1_000_000;
    const rl = new LoginRateLimiter(() => now);
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: 'dave', ip: '1.2.3.4' });
    }
    expect(rl.check({ username: 'dave', ip: '1.2.3.4' }).throttled).toBe(true);
    now += LOGIN_RATELIMIT_WINDOW_MS + 1;
    expect(rl.check({ username: 'dave', ip: '1.2.3.4' }).throttled).toBe(false);
  });
});
