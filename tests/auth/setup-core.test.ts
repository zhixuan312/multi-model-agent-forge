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
  it('is true only when no HUMAN member exists', async () => {
    expect(await isFirstRun(createMockDb({ 'select:team_member': [{ count: 0 }] }))).toBe(true);
    expect(await isFirstRun(createMockDb({ 'select:team_member': [{ count: 3 }] }))).toBe(false);
  });

  it('excludes the Forge system member from the first-run count', async () => {
    // A freshly-migrated DB always has the seeded Forge automation member. If the
    // count included it, setup would be permanently closed and no human could ever
    // register — so the query MUST filter it out by the sentinel id. Dropping that
    // filter removes the `where` clause entirely, which this catches.
    const db = createMockDb({ 'select:team_member': [{ count: 0 }] });
    await isFirstRun(db);
    const whereCalls = db._callsFor('team_member').filter((c) => c.method === 'where');
    expect(whereCalls.length).toBeGreaterThan(0);
    // The drizzle SQL condition is a cyclic object graph; walk it (cycle-safe) and
    // confirm the sentinel id is baked into the filter.
    const seen = new WeakSet<object>();
    const containsSentinel = (v: unknown): boolean => {
      if (v === '00000000-0000-0000-0000-000000000000') return true;
      if (typeof v !== 'object' || v === null) return false;
      if (seen.has(v)) return false;
      seen.add(v);
      return Object.values(v as Record<string, unknown>).some(containsSentinel);
    };
    expect(containsSentinel(whereCalls)).toBe(true);
  });
});

describe('createAdminMember', () => {
  it('inserts an org_admin member + one local identity; hashes the password', async () => {
    const created = createBaseMember({ id: 'a1', username: 'admin', role: 'org_admin', teamId: null });
    const db = createMockDb({ 'insert:team_member': [created] });
    const m = await createAdminMember(db, { displayName: 'Admin', username: 'admin', password: STRONG });
    expect(m.role).toBe('org_admin');
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
    const created = createBaseMember({ id: 'a1', username: 'admin', role: 'org_admin', teamId: null });
    const db = createMockDb({ 'select:team_member': [{ count: 0 }], 'insert:team_member': [created] });
    const res = await registerFirstAdmin({ displayName: 'Admin', username: 'admin', password: STRONG }, { db });
    expect(res.kind).toBe('created');
    if (res.kind === 'created') expect(res.member.role).toBe('org_admin');
  });
});
