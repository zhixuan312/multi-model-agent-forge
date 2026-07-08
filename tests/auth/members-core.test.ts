// @vitest-environment node
import { vi } from 'vitest';
import {
  createMember,
  setMemberAdmin,
  resetMemberPassword,
  deleteMember,
  listMembers,
  createMemberSchema,
  toggleAdminSchema,
  resetPasswordSchema,
} from '@/auth/members-core';
import type { SessionStore } from '@/auth/session-store';
import { createMockDb, seq } from '../test-utils/mock-db';
import { createBaseMember } from '../test-utils/factories';

// Backend tests run on a mocked Drizzle `Db` (the gumi convention) — no database
// is touched. The shared password policy is covered in password.test.ts.
const STRONG = 'a-strong-password';
const stubStore = () => ({ revokeAllForMember: vi.fn(async () => {}) }) as unknown as SessionStore;

describe('input schemas', () => {
  it('createMemberSchema trims + requires displayName/username + a policy password', () => {
    const r = createMemberSchema.safeParse({ displayName: '  Ada  ', username: '  ada  ', password: STRONG });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ displayName: 'Ada', username: 'ada' });
    expect(createMemberSchema.safeParse({ displayName: '', username: 'x', password: STRONG }).success).toBe(false);
    expect(createMemberSchema.safeParse({ displayName: 'X', username: 'x', password: 'short' }).success).toBe(false);
  });

  it('toggleAdminSchema requires a boolean; resetPasswordSchema requires a policy password', () => {
    expect(toggleAdminSchema.safeParse({ isAdmin: 'yes' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ newPassword: 'short' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ newPassword: STRONG }).success).toBe(true);
  });
});

describe('createMember', () => {
  it('inserts member + one local identity with teamId; hashes the password (never stores plaintext)', async () => {
    const created = createBaseMember({ id: 'm1', username: 'ada', role: 'member', teamId: 'team-1' });
    const db = createMockDb({ 'select:team_member': [], 'insert:team_member': [created] });
    const res = await createMember({ displayName: 'Ada', username: 'ada', password: STRONG }, 'team-1', { db });

    expect(res.kind).toBe('created');
    if (res.kind !== 'created') return;
    expect(res.member.id).toBe('m1');
    expect(db._assertCalled('team_member', 'insert')).toBe(true);
    expect(db._assertCalled('team_identity', 'insert')).toBe(true);
    const idValues = db._callsFor('team_identity').find((c) => c.method === 'values');
    expect(JSON.stringify(idValues?.args)).not.toContain(STRONG); // argon2 hash, not plaintext
  });

  it('rejects invalid input with no DB writes', async () => {
    const db = createMockDb();
    expect((await createMember({ displayName: '', username: '', password: 'short' }, 'team-1', { db })).kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });

  it('returns duplicate_username on the case-insensitive pre-check', async () => {
    const db = createMockDb({ 'select:team_member': [{ id: 'existing' }] });
    expect((await createMember({ displayName: 'A', username: 'ADA', password: STRONG }, 'team-1', { db })).kind).toBe('duplicate_username');
    expect(db._assertCalled('team_member', 'insert')).toBe(false);
  });

  it('maps a 23505 unique-violation race to duplicate_username', async () => {
    const db = createMockDb({
      'select:team_member': [],
      'insert:team_member': Object.assign(new Error('dup'), { code: '23505' }),
    });
    expect((await createMember({ displayName: 'A', username: 'ada', password: STRONG }, 'team-1', { db })).kind).toBe('duplicate_username');
  });
});

describe('setMemberAdmin (last-admin invariant)', () => {
  it('not_found when the member is missing', async () => {
    const db = createMockDb({ 'select:team_member': [] });
    expect((await setMemberAdmin('x', { isAdmin: true }, { db })).kind).toBe('not_found');
  });

  it('refuses to demote the only admin (last_admin)', async () => {
    const db = createMockDb({ 'select:team_member': seq([{ id: 'm1', isAdmin: true }], [{ count: 0 }]) });
    expect((await setMemberAdmin('m1', { isAdmin: false }, { db })).kind).toBe('last_admin');
    expect(db._assertCalled('team_member', 'update')).toBe(false);
  });

  it('demotes when other admins remain', async () => {
    const db = createMockDb({ 'select:team_member': seq([{ id: 'm1', isAdmin: true }], [{ count: 2 }]) });
    expect((await setMemberAdmin('m1', { isAdmin: false }, { db })).kind).toBe('updated');
    expect(db._assertCalled('team_member', 'update')).toBe(true);
  });

  it('promotes without a guard check', async () => {
    const db = createMockDb({ 'select:team_member': [{ id: 'm1', isAdmin: false }] });
    expect((await setMemberAdmin('m1', { isAdmin: true }, { db })).kind).toBe('updated');
  });
});

describe('resetMemberPassword', () => {
  it('not_found when the member has no local identity', async () => {
    const db = createMockDb({ 'select:team_identity': [] });
    expect((await resetMemberPassword('m1', { newPassword: STRONG }, { db, store: stubStore() })).kind).toBe('not_found');
  });

  it('updates the hash and revokes the target sessions', async () => {
    const db = createMockDb({ 'select:team_identity': [{ id: 'i1' }] });
    const store = stubStore();
    const res = await resetMemberPassword('m1', { newPassword: STRONG }, { db, store });
    expect(res.kind).toBe('reset');
    expect(db._assertCalled('team_identity', 'update')).toBe(true);
    expect(store.revokeAllForMember).toHaveBeenCalledWith('m1');
  });
});

describe('deleteMember (last-admin invariant)', () => {
  it('not_found when missing', async () => {
    const db = createMockDb({ 'select:team_member': [] });
    expect((await deleteMember('x', { db })).kind).toBe('not_found');
  });

  it('refuses to delete the only admin', async () => {
    const db = createMockDb({ 'select:team_member': seq([{ id: 'm1', isAdmin: true }], [{ count: 0 }]) });
    expect((await deleteMember('m1', { db })).kind).toBe('last_admin');
    expect(db._assertCalled('team_member', 'delete')).toBe(false);
  });

  it('deletes a non-admin', async () => {
    const db = createMockDb({ 'select:team_member': [{ id: 'm1', isAdmin: false }] });
    expect((await deleteMember('m1', { db })).kind).toBe('deleted');
    expect(db._assertCalled('team_member', 'delete')).toBe(true);
  });
});

describe('listMembers', () => {
  it('returns the member rows', async () => {
    const rows = [createBaseMember({ id: 'm1' }), createBaseMember({ id: 'm2', username: 'bob' })];
    const db = createMockDb({ 'select:team_member': rows });
    expect(await listMembers({ db })).toHaveLength(2);
  });
});
