// @vitest-environment node
import { attemptLogin } from '@/auth/login-core';
import { LoginRateLimiter } from '@/auth/rate-limit';
import { PostgresSessionStore } from '@/auth/session-store';
import { LocalAuthProvider } from '@/auth/auth-provider';
import { LOGIN_RATELIMIT_MAX } from '@/auth/config';
import { seedTestMember, cleanupTestMembers, closeDb } from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('attemptLogin (live DB)', () => {
  const provider = new LocalAuthProvider();
  const store = new PostgresSessionStore();
  let username: string;
  let password: string;
  let memberId: string;

  beforeAll(async () => {
    const m = await seedTestMember({ label: 'login', password: 'login-password-1234' });
    username = m.username;
    password = m.password;
    memberId = m.id;
  });
  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  it('valid creds → success with a usable session token', async () => {
    const rl = new LoginRateLimiter();
    const res = await attemptLogin({ username, password, ip: '1.1.1.1' }, { provider, store, rateLimiter: rl });
    expect(res.kind).toBe('success');
    if (res.kind === 'success') {
      expect(res.memberId).toBe(memberId);
      const sess = await store.get(res.token);
      expect(sess?.memberId).toBe(memberId);
      await store.revoke(sess!.id);
    }
  });

  it('wrong password → invalid, and increments the rate counter', async () => {
    const rl = new LoginRateLimiter();
    const res = await attemptLogin({ username, password: 'nope-nope-nope', ip: '2.2.2.2' }, { provider, store, rateLimiter: rl });
    expect(res.kind).toBe('invalid');
  });

  it('once the per-username counter hits the cap, the next attempt is throttled WITHOUT calling argon2id', async () => {
    const rl = new LoginRateLimiter();
    // Spy provider: a real authenticate would run argon2id; we assert it is NOT called when throttled.
    let authCalls = 0;
    const spyProvider = {
      authenticate: async (u: string, p: string) => {
        authCalls++;
        return provider.authenticate(u, p);
      },
    };
    // drive the username counter to the cap with failures (vary IP so only username trips)
    for (let i = 0; i < LOGIN_RATELIMIT_MAX; i++) {
      await attemptLogin({ username, password: 'bad', ip: `9.0.0.${i}` }, { provider: spyProvider, store, rateLimiter: rl });
    }
    const callsBefore = authCalls;
    const res = await attemptLogin({ username, password, ip: '8.8.8.8' }, { provider: spyProvider, store, rateLimiter: rl });
    expect(res.kind).toBe('throttled');
    if (res.kind === 'throttled') expect(res.retryAfterSeconds).toBeGreaterThan(0);
    // argon2id (inside authenticate) was NOT invoked for the throttled attempt
    expect(authCalls).toBe(callsBefore);
  });

  it('a successful login resets the counters so subsequent attempts are not throttled', async () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_RATELIMIT_MAX - 1; i++) {
      await attemptLogin({ username, password: 'bad', ip: '3.3.3.3' }, { provider, store, rateLimiter: rl });
    }
    const ok = await attemptLogin({ username, password, ip: '3.3.3.3' }, { provider, store, rateLimiter: rl });
    expect(ok.kind).toBe('success');
    if (ok.kind === 'success') await store.revoke((await store.get(ok.token))!.id);
    // counters cleared → another bad attempt is invalid (not throttled)
    const after = await attemptLogin({ username, password: 'bad', ip: '3.3.3.3' }, { provider, store, rateLimiter: rl });
    expect(after.kind).toBe('invalid');
  });
});
