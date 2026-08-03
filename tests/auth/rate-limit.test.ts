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

  it('a successful login clears that USERNAME\'s counter', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: 'carol', ip: `4.4.4.${i}` });
    }
    expect(rl.check({ username: 'carol', ip: '9.9.9.9' }).throttled).toBe(true);
    rl.recordSuccess({ username: 'carol', ip: '9.9.9.9' });
    expect(rl.check({ username: 'carol', ip: '9.9.9.9' }).throttled).toBe(false);
  });

  /**
   * It used to clear the IP counter too, which handed the per-IP half of the limiter to
   * anyone holding ONE valid credential: fail nine times across nine other usernames, log
   * in as yourself, and the address is clear again — repeat without limit. Per-account
   * lockout still held, but per-IP is the counter that bounds total failure volume from a
   * host, which is what spraying across many usernames looks like.
   */
  it('a successful login does NOT clear the IP counter', () => {
    const rl = new LoginRateLimiter();
    // Nine failures against other people's accounts, all from one address.
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      rl.recordFailure({ username: `victim-${i}`, ip: '4.4.4.4' });
    }
    expect(rl.check({ username: 'attacker', ip: '4.4.4.4' }).throttled).toBe(true);

    // The attacker logs in with their OWN valid credential.
    rl.recordSuccess({ username: 'attacker', ip: '4.4.4.4' });

    // The address is still throttled — the reset does not travel to the IP bucket.
    const v = rl.check({ username: 'victim-99', ip: '4.4.4.4' });
    expect(v.throttled).toBe(true);
    expect(v.key).toBe('ip:4.4.4.4');
  });

  it('and the IP counter still clears on its own window', () => {
    let now = 1_000_000;
    const rl = new LoginRateLimiter(() => now);
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) rl.recordFailure({ username: `u${i}`, ip: '5.5.5.5' });
    expect(rl.check({ username: 'z', ip: '5.5.5.5' }).throttled).toBe(true);
    now += LOGIN_RATELIMIT_WINDOW_MS + 1;
    expect(rl.check({ username: 'z', ip: '5.5.5.5' }).throttled).toBe(false);
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
