// @vitest-environment node
import {
  parseSetupForm,
  isFirstRun,
  createAdminMember,
  registerFirstAdmin,
} from '@/auth/setup-core';
import { createMockDb } from '../test-utils/mock-db';
import { createBaseMember } from '../test-utils/factories';

// Backend tests run on a mocked Drizzle `Db` (the gumi convention) — no database.
const STRONG = 'a-strong-password-1234';

describe('parseSetupForm (pure form validation)', () => {
  it('accepts a valid submission and drops confirmPassword', () => {
    expect(
      parseSetupForm({ displayName: 'Ada', username: 'ada', password: STRONG, confirmPassword: STRONG }),
    ).toEqual({ ok: true, data: { displayName: 'Ada', username: 'ada', password: STRONG } });
  });

  it('rejects a mismatched confirmation, a short password, and blank fields', () => {
    expect(parseSetupForm({ displayName: 'Ada', username: 'ada', password: STRONG, confirmPassword: 'other-1234' }))
      .toEqual({ ok: false, error: 'passwords_mismatch' });
    expect(parseSetupForm({ displayName: 'Ada', username: 'ada', password: 'short', confirmPassword: 'short' }))
      .toEqual({ ok: false, error: 'invalid' });
    expect(parseSetupForm({ displayName: '', username: 'ada', password: STRONG, confirmPassword: STRONG }))
      .toEqual({ ok: false, error: 'invalid' });
  });
});

describe('isFirstRun', () => {
  it('is true only when the member table is empty', async () => {
    expect(await isFirstRun(createMockDb({ 'select:team_member': [{ count: 0 }] }))).toBe(true);
    expect(await isFirstRun(createMockDb({ 'select:team_member': [{ count: 3 }] }))).toBe(false);
  });
});

describe('createAdminMember', () => {
  it('inserts an is_admin member + one local identity; hashes the password', async () => {
    const created = createBaseMember({ id: 'a1', username: 'admin', isAdmin: true });
    const db = createMockDb({ 'insert:team_member': [created] });
    const m = await createAdminMember(db, { displayName: 'Admin', username: 'admin', password: STRONG });
    expect(m.isAdmin).toBe(true);
    expect(db._assertCalled('team_identity', 'insert')).toBe(true);
    const idValues = db._callsFor('team_identity').find((c) => c.method === 'values');
    expect(JSON.stringify(idValues?.args)).not.toContain(STRONG);
  });
});

describe('registerFirstAdmin', () => {
  it('rejects invalid input before any DB work', async () => {
    const db = createMockDb();
    expect((await registerFirstAdmin({ displayName: '', username: '', password: 'short' }, { db })).kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });

  it('refuses (already_setup) when a member already exists, creating nothing', async () => {
    const db = createMockDb({ 'select:team_member': [{ count: 1 }] });
    const res = await registerFirstAdmin({ displayName: 'X', username: 'x', password: STRONG }, { db });
    expect(res.kind).toBe('already_setup');
    expect(db._assertCalled('team_member', 'insert')).toBe(false);
  });

  it('creates the first admin when the team is empty', async () => {
    const created = createBaseMember({ id: 'a1', username: 'admin', isAdmin: true });
    const db = createMockDb({ 'select:team_member': [{ count: 0 }], 'insert:team_member': [created] });
    const res = await registerFirstAdmin({ displayName: 'Admin', username: 'admin', password: STRONG }, { db });
    expect(res.kind).toBe('created');
    if (res.kind === 'created') expect(res.member.isAdmin).toBe(true);
  });
});
