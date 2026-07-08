// @vitest-environment node
import { vi } from 'vitest';
import { attemptLogin } from '@/auth/login-core';
import type { AuthProvider } from '@/auth/auth-provider';
import type { SessionStore } from '@/auth/session-store';
import type { LoginRateLimiter } from '@/auth/rate-limit';

// attemptLogin orchestrates injected deps (provider / store / rate-limiter) and
// touches no database — tests inject mocks (the gumi convention).
const INPUT = { username: 'ada', password: 'pw-1234', ip: '1.2.3.4' };

function deps(over: {
  authenticate?: AuthProvider['authenticate'];
  check?: LoginRateLimiter['check'];
} = {}) {
  const provider = { authenticate: over.authenticate ?? vi.fn(async () => null) } as unknown as AuthProvider;
  const store = { create: vi.fn(async () => ({ token: 'tok', record: { id: 's1' } })) } as unknown as SessionStore;
  const rateLimiter = {
    check: over.check ?? vi.fn(() => ({ throttled: false })),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  } as unknown as LoginRateLimiter;
  return { provider, store, rateLimiter };
}

describe('attemptLogin', () => {
  it('throttles WITHOUT running authentication when the rate limiter trips', async () => {
    const d = deps({ check: vi.fn(() => ({ throttled: true, retryAfterSeconds: 30, key: 'u:ada' })) as never });
    const res = await attemptLogin(INPUT, d);
    expect(res).toEqual({ kind: 'throttled', retryAfterSeconds: 30 });
    expect(d.provider.authenticate).not.toHaveBeenCalled();
  });

  it('returns a generic invalid + records a failure when authentication fails', async () => {
    const d = deps({ authenticate: vi.fn(async () => null) });
    const res = await attemptLogin(INPUT, d);
    expect(res.kind).toBe('invalid');
    expect(d.rateLimiter.recordFailure).toHaveBeenCalled();
    expect(d.store.create).not.toHaveBeenCalled();
  });

  it('creates a session + resets the counters on success', async () => {
    const d = deps({ authenticate: vi.fn(async () => ({ id: 'm1', username: 'ada', displayName: 'Ada', avatarTint: '#9a6b4f', role: 'member' as const, teamId: 'team-1' })) });
    const res = await attemptLogin(INPUT, d);
    expect(res).toEqual({ kind: 'success', token: 'tok', memberId: 'm1' });
    expect(d.store.create).toHaveBeenCalledWith('m1');
    expect(d.rateLimiter.recordSuccess).toHaveBeenCalled();
  });
});
