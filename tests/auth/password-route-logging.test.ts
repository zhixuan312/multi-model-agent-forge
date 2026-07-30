// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { LogRecord } from '@/observability/log-event';

let session: { member: { id: string }; session: { id: string } } | null = null;
vi.mock('@/auth/current-member', () => ({ currentSession: async () => session }));

const changeOwnPassword = vi.fn();
vi.mock('@/auth/change-password-core', () => ({ changeOwnPassword }));

import { setLogSink } from '@/observability/log-event';
const { POST } = await import('../../app/api/auth/password/route');

const body = (b: unknown) =>
  new Request('http://x/api/auth/password', { method: 'POST', body: JSON.stringify(b) }) as never;

/**
 * `session.revoke` is a security-relevant event: a successful password change drops every
 * OTHER session for the member. The name was in the catalog from the start but nothing
 * emitted it, so the one auth action that signs other devices out left no operational
 * trace. These lock the emission so it cannot be dropped again silently.
 */
describe('POST /api/auth/password — operational logging', () => {
  let captured: LogRecord[] = [];
  let restore: () => void;

  beforeEach(() => {
    captured = [];
    restore = setLogSink((r) => captured.push(r));
    changeOwnPassword.mockReset();
    session = { member: { id: 'me' }, session: { id: 's1' } };
  });

  it('emits session.revoke on a successful change', async () => {
    changeOwnPassword.mockResolvedValue({ kind: 'success', token: 'tok' });
    const res = await POST(body({ currentPassword: 'old-password-1', newPassword: 'a-new-password-9' }));
    restore();
    expect(res.status).toBe(200);
    const rec = captured.find((r) => r.event === 'session.revoke');
    expect(rec).toBeDefined();
    expect(rec).toMatchObject({ actorId: 'me', targetId: 'me' });
  });

  it('does NOT log a revoke when the current password was wrong — nothing was revoked', async () => {
    changeOwnPassword.mockResolvedValue({ kind: 'wrong_current_password' });
    const res = await POST(body({ currentPassword: 'nope', newPassword: 'a-new-password-9' }));
    restore();
    expect(res.status).toBe(400);
    expect(captured.find((r) => r.event === 'session.revoke')).toBeUndefined();
  });

  it('does NOT log a revoke for an unauthenticated caller', async () => {
    session = null;
    const res = await POST(body({ currentPassword: 'x', newPassword: 'a-new-password-9' }));
    restore();
    expect(res.status).toBe(401);
    expect(captured).toEqual([]);
  });

  it('never puts a password in the log record', async () => {
    changeOwnPassword.mockResolvedValue({ kind: 'success', token: 'tok' });
    await POST(body({ currentPassword: 'old-password-1', newPassword: 'super-secret-99' }));
    restore();
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain('super-secret-99');
    expect(serialized).not.toContain('old-password-1');
  });
});
