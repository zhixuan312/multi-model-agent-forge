// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import {
  isFirstRun,
  createAdminMember,
  registerFirstAdmin,
  parseSetupForm,
} from '@/auth/setup-core';
import { verifyPassword } from '@/auth/password';
import {
  seedTestMember,
  cleanupTestMembers,
  closeDb,
  uniqueUsername,
} from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const strongPassword = 'a-strong-password-1234';

describe('parseSetupForm (pure form validation)', () => {
  it('accepts a valid submission and drops confirmPassword from the result', () => {
    const res = parseSetupForm({
      displayName: 'Ada Lovelace',
      username: 'ada',
      password: strongPassword,
      confirmPassword: strongPassword,
    });
    expect(res).toEqual({
      ok: true,
      data: { displayName: 'Ada Lovelace', username: 'ada', password: strongPassword },
    });
  });

  it('rejects a mismatched confirmation as passwords_mismatch', () => {
    const res = parseSetupForm({
      displayName: 'Ada',
      username: 'ada',
      password: strongPassword,
      confirmPassword: 'a-different-password-1234',
    });
    expect(res).toEqual({ ok: false, error: 'passwords_mismatch' });
  });

  it('rejects a too-short password as invalid (length checked before confirm match)', () => {
    const res = parseSetupForm({
      displayName: 'Ada',
      username: 'ada',
      password: 'short',
      confirmPassword: 'short',
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
  });

  it('rejects a blank username or display name as invalid', () => {
    expect(
      parseSetupForm({ displayName: '', username: 'ada', password: strongPassword, confirmPassword: strongPassword }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      parseSetupForm({ displayName: 'Ada', username: '   ', password: strongPassword, confirmPassword: strongPassword }),
    ).toEqual({ ok: false, error: 'invalid' });
  });
});

describe.skipIf(!hasDb)('setup-core (live DB)', () => {
  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  describe('createAdminMember', () => {
    it('inserts an is_admin member + exactly one local identity with a verifiable hash', async () => {
      const username = uniqueUsername('admin');
      const m = await createAdminMember(getDb(), {
        displayName: 'The Admin',
        username,
        password: strongPassword,
      });

      expect(m.isAdmin).toBe(true);
      expect(m.username).toBe(username);
      expect(m.displayName).toBe('The Admin');
      // password must never be echoed back
      expect(JSON.stringify(m)).not.toContain(strongPassword);

      const ids = await getDb()
        .select()
        .from(memberIdentity)
        .where(eq(memberIdentity.memberId, m.id));
      expect(ids).toHaveLength(1);
      expect(ids[0].provider).toBe('local');
      expect(await verifyPassword(strongPassword, ids[0].passwordHash!)).toBe(true);
    });
  });

  describe('isFirstRun', () => {
    it('is false when at least one member exists', async () => {
      await seedTestMember(); // guarantee the table is non-empty
      expect(await isFirstRun()).toBe(false);
    });
  });

  describe('registerFirstAdmin', () => {
    it('returns invalid for bad input without touching the DB', async () => {
      const res = await registerFirstAdmin({ displayName: '', username: '', password: 'short' });
      expect(res.kind).toBe('invalid');
    });

    it('refuses when members already exist (already_setup) and creates nothing', async () => {
      await seedTestMember(); // ensure the gate is closed
      if (await isFirstRun()) return; // only meaningful when the DB is non-empty

      const username = uniqueUsername('blocked');
      const res = await registerFirstAdmin({
        displayName: 'Should Not Exist',
        username,
        password: strongPassword,
      });
      expect(res.kind).toBe('already_setup');

      const found = await getDb()
        .select({ id: member.id })
        .from(member)
        .where(sql`${member.username} = ${username}`);
      expect(found).toHaveLength(0);
    });
  });
});
