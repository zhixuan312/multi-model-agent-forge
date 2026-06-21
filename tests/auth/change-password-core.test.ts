// @vitest-environment node
import { vi } from 'vitest';
import { changeOwnPassword } from '@/auth/change-password-core';
import { hashPassword } from '@/auth/password';
import type { SessionStore } from '@/auth/session-store';
import { createMockDb } from '../test-utils/mock-db';

// changeOwnPassword is dependency-injected (db + store); tests run on a mock DB +
// real argon2 (no database). The min-length policy is covered in password.test.ts.
const CURRENT = 'current-password-1234';
const NEXT = 'a-new-strong-password';

function store() {
  return {
    create: vi.fn(async () => ({ token: 'fresh-token', record: { id: 's-new' } })),
    revokeAllForMemberExcept: vi.fn(async () => {}),
  } as unknown as SessionStore;
}

describe('changeOwnPassword', () => {
  it('rejects a too-short new password before any DB work', async () => {
    const db = createMockDb();
    const res = await changeOwnPassword({ memberId: 'm1', currentPassword: CURRENT, newPassword: 'short' }, { db, store: store() });
    expect(res.kind).toBe('invalid_new_password');
    expect(db._calls).toHaveLength(0);
  });

  it('returns no_identity when the member has no local credential', async () => {
    const db = createMockDb({ 'select:team_identity': [] });
    const res = await changeOwnPassword({ memberId: 'm1', currentPassword: CURRENT, newPassword: NEXT }, { db, store: store() });
    expect(res.kind).toBe('no_identity');
  });

  it('returns wrong_current_password when the current password does not verify', async () => {
    const hash = await hashPassword(CURRENT);
    const db = createMockDb({ 'select:team_identity': [{ id: 'i1', passwordHash: hash }] });
    const res = await changeOwnPassword({ memberId: 'm1', currentPassword: 'WRONG', newPassword: NEXT }, { db, store: store() });
    expect(res.kind).toBe('wrong_current_password');
    expect(db._assertCalled('team_identity', 'update')).toBe(false);
  });

  it('rotates the hash, re-issues the caller session, and revokes the others', async () => {
    const hash = await hashPassword(CURRENT);
    const db = createMockDb({ 'select:team_identity': [{ id: 'i1', passwordHash: hash }] });
    const st = store();
    const res = await changeOwnPassword({ memberId: 'm1', currentPassword: CURRENT, newPassword: NEXT }, { db, store: st });
    expect(res).toEqual({ kind: 'success', token: 'fresh-token' });
    expect(db._assertCalled('team_identity', 'update')).toBe(true);
    expect(st.create).toHaveBeenCalledWith('m1');
    expect(st.revokeAllForMemberExcept).toHaveBeenCalledWith('m1', 's-new');
    const set = db._callsFor('team_identity').find((c) => c.method === 'set');
    expect(JSON.stringify(set?.args)).not.toContain(NEXT); // hash, not plaintext
  });
});
