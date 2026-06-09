// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member, memberIdentity, session } from '@/db/schema/identity';
import {
  createMember,
  setMemberAdmin,
  resetMemberPassword,
  deleteMember,
  listMembers,
} from '@/auth/members-core';
import { PostgresSessionStore } from '@/auth/session-store';
import { verifyPassword } from '@/auth/password';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';
import {
  seedTestMember,
  cleanupTestMembers,
  closeDb,
  uniqueUsername,
} from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const strongPassword = 'a-strong-password-1234';

describe.skipIf(!hasDb)('members-core (live DB)', () => {
  const db = getDb();
  const store = new PostgresSessionStore();

  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  describe('createMember', () => {
    it('creates a member + exactly one local identity with a hashed password', async () => {
      const username = uniqueUsername('create');
      const res = await createMember({ displayName: 'Create One', username, password: strongPassword });
      expect(res.kind).toBe('created');
      if (res.kind !== 'created') return;

      expect(res.member.username).toBe(username);
      expect(res.member.displayName).toBe('Create One');
      expect(res.member.isAdmin).toBe(false);
      expect(res.member.avatarTint).toMatch(/^#[0-9a-f]{6}$/i);
      // password is NOT echoed
      expect(JSON.stringify(res.member)).not.toContain(strongPassword);

      const identities = await db
        .select()
        .from(memberIdentity)
        .where(eq(memberIdentity.memberId, res.member.id));
      expect(identities).toHaveLength(1);
      expect(identities[0].provider).toBe('local');
      expect(identities[0].passwordHash).toBeTruthy();
      expect(await verifyPassword(strongPassword, identities[0].passwordHash!)).toBe(true);
    });

    it('rejects a duplicate username (409 → duplicate_username)', async () => {
      const username = uniqueUsername('dup');
      await createMember({ displayName: 'First', username, password: strongPassword });
      const again = await createMember({ displayName: 'Second', username, password: strongPassword });
      expect(again.kind).toBe('duplicate_username');
    });

    it('rejects a case-variant duplicate (lower(username) functional unique index)', async () => {
      const base = uniqueUsername('Case');
      await createMember({ displayName: 'Lower', username: base.toLowerCase(), password: strongPassword });
      const variant = await createMember({
        displayName: 'Upper',
        username: base.toUpperCase(),
        password: strongPassword,
      });
      expect(variant.kind).toBe('duplicate_username');
    });

    it('rejects a weak/empty password (400 → invalid)', async () => {
      const tooShort = 'x'.repeat(PASSWORD_MIN_LENGTH - 1);
      const weak = await createMember({
        displayName: 'Weak',
        username: uniqueUsername('weak'),
        password: tooShort,
      });
      expect(weak.kind).toBe('invalid');

      const empty = await createMember({
        displayName: 'Empty',
        username: uniqueUsername('empty'),
        password: '',
      });
      expect(empty.kind).toBe('invalid');
    });

    it('rejects a missing field (400 → invalid)', async () => {
      const res = await createMember({ username: uniqueUsername('nofield'), password: strongPassword });
      expect(res.kind).toBe('invalid');
    });
  });

  describe('setMemberAdmin (toggle)', () => {
    it('promotes a non-admin then demotes back (while another admin exists)', async () => {
      // an admin must exist so the demote does not trip the last-admin guard
      await seedTestMember({ label: 'keepadmin', isAdmin: true });
      const target = await seedTestMember({ label: 'toggle', isAdmin: false });

      const up = await setMemberAdmin(target.id, { isAdmin: true });
      expect(up).toEqual({ kind: 'updated', id: target.id, isAdmin: true });
      let [row] = await db.select({ isAdmin: member.isAdmin }).from(member).where(eq(member.id, target.id));
      expect(row.isAdmin).toBe(true);

      const down = await setMemberAdmin(target.id, { isAdmin: false });
      expect(down.kind).toBe('updated');
      [row] = await db.select({ isAdmin: member.isAdmin }).from(member).where(eq(member.id, target.id));
      expect(row.isAdmin).toBe(false);
    });

    it('rejects demoting the last admin (409 → last_admin)', async () => {
      // The last-admin invariant counts ALL admins (incl. the real bootstrap
      // admin). To exercise the "only one admin left" branch on a live shared
      // DB, temporarily demote every pre-existing admin, then restore them.
      await withSoleAdmin(async (onlyAdmin) => {
        const res = await setMemberAdmin(onlyAdmin.id, { isAdmin: false });
        expect(res.kind).toBe('last_admin');
      });
    });

    it('returns not_found for an unknown member', async () => {
      const res = await setMemberAdmin('00000000-0000-0000-0000-000000000000', { isAdmin: true });
      expect(res.kind).toBe('not_found');
    });

    it('rejects an invalid body', async () => {
      const m = await seedTestMember({ label: 'badbody' });
      const res = await setMemberAdmin(m.id, { isAdmin: 'yes' });
      expect(res.kind).toBe('invalid');
    });
  });

  describe('resetMemberPassword', () => {
    it('sets a new hash, bumps password_changed_at, and drops the target sessions', async () => {
      const target = await seedTestMember({ label: 'reset', password: 'old-password-1234' });
      // give the target a live session
      const created = await store.create(target.id);
      expect(await store.get(created.token)).not.toBeNull();

      const before = await db
        .select({ pw: memberIdentity.passwordHash, changed: memberIdentity.passwordChangedAt })
        .from(memberIdentity)
        .where(and(eq(memberIdentity.memberId, target.id), eq(memberIdentity.provider, 'local')));

      const res = await resetMemberPassword(target.id, { newPassword: 'brand-new-password-9876' });
      expect(res.kind).toBe('reset');

      const after = await db
        .select({ pw: memberIdentity.passwordHash, changed: memberIdentity.passwordChangedAt })
        .from(memberIdentity)
        .where(and(eq(memberIdentity.memberId, target.id), eq(memberIdentity.provider, 'local')));

      expect(after[0].pw).not.toBe(before[0].pw);
      expect(await verifyPassword('brand-new-password-9876', after[0].pw!)).toBe(true);
      expect(after[0].changed).not.toBeNull();

      // target sessions are gone
      const remaining = await db.select().from(session).where(eq(session.memberId, target.id));
      expect(remaining).toHaveLength(0);
    });

    it('rejects a weak new password (400 → invalid)', async () => {
      const target = await seedTestMember({ label: 'resetweak' });
      const res = await resetMemberPassword(target.id, { newPassword: 'short' });
      expect(res.kind).toBe('invalid');
    });

    it('returns not_found for an unknown member', async () => {
      const res = await resetMemberPassword('00000000-0000-0000-0000-000000000000', {
        newPassword: strongPassword,
      });
      expect(res.kind).toBe('not_found');
    });
  });

  describe('deleteMember', () => {
    it('hard-deletes a member and cascades identity + sessions', async () => {
      const target = await seedTestMember({ label: 'del' });
      const created = await store.create(target.id);

      const res = await deleteMember(target.id);
      expect(res.kind).toBe('deleted');

      const m = await db.select().from(member).where(eq(member.id, target.id));
      expect(m).toHaveLength(0);
      const ids = await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, target.id));
      expect(ids).toHaveLength(0);
      const ss = await db.select().from(session).where(eq(session.id, created.record.id));
      expect(ss).toHaveLength(0);
    });

    it('rejects deleting the last admin (409 → last_admin)', async () => {
      await withSoleAdmin(async (onlyAdmin) => {
        const res = await deleteMember(onlyAdmin.id);
        expect(res.kind).toBe('last_admin');
      });
    });

    it('returns not_found for an unknown member', async () => {
      const res = await deleteMember('00000000-0000-0000-0000-000000000000');
      expect(res.kind).toBe('not_found');
    });
  });

  describe('listMembers', () => {
    it('returns rows including a just-created throwaway member', async () => {
      const m = await seedTestMember({ label: 'listed' });
      const rows = await listMembers();
      const found = rows.find((r) => r.id === m.id);
      expect(found).toBeDefined();
      expect(found?.username).toBe(m.username);
    });
  });
  // ---- helpers ----

  /**
   * Run `body` in a world where exactly ONE admin exists (a fresh throwaway).
   * The last-admin invariant counts every admin in the table, including the
   * real bootstrap admin, so to reach the "only one admin" branch we capture +
   * demote all pre-existing admins for the duration, then restore them. Safe on
   * a live shared DB — the original admin set is restored in `finally`.
   */
  async function withSoleAdmin(body: (onlyAdmin: { id: string }) => Promise<void>): Promise<void> {
    const priorAdmins = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.isAdmin, true));
    const priorIds = priorAdmins.map((a) => a.id);
    try {
      if (priorIds.length > 0) {
        await db.update(member).set({ isAdmin: false }).where(inArray(member.id, priorIds));
      }
      const onlyAdmin = await seedTestMember({ label: 'soleadmin', isAdmin: true });
      await body({ id: onlyAdmin.id });
    } finally {
      if (priorIds.length > 0) {
        await db.update(member).set({ isAdmin: true }).where(inArray(member.id, priorIds));
      }
    }
  }
});
