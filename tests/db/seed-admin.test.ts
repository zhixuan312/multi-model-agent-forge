// @vitest-environment node
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import { seedFirstAdmin } from '@/db/seed-admin';
import { cleanupTestMembers, closeDb, TEST_USERNAME_PREFIX } from '../auth/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;

/** Count of real (non-test) members — the seed's idempotence is keyed on a
 *  zero member count, so these tests run only against an EMPTY members table.
 *  If the DB already holds members, the empty-DB cases are skipped (idempotence
 *  is still exercised by the "members exist" case). */
async function memberCount(): Promise<number> {
  const [{ c }] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(member);
  return c;
}

describe.skipIf(!hasDb)('seedFirstAdmin (live DB)', () => {
  const origUser = process.env.FORGE_ADMIN_USERNAME;
  const origPass = process.env.FORGE_ADMIN_PASSWORD;

  afterEach(async () => {
    process.env.FORGE_ADMIN_USERNAME = origUser;
    process.env.FORGE_ADMIN_PASSWORD = origPass;
    await cleanupTestMembers();
  });
  afterAll(async () => {
    process.env.FORGE_ADMIN_USERNAME = origUser;
    process.env.FORGE_ADMIN_PASSWORD = origPass;
    await closeDb();
  });

  it('empty DB → creates exactly one is_admin member + a local identity', async () => {
    if ((await memberCount()) > 0) return; // only meaningful on an empty members table
    process.env.FORGE_ADMIN_USERNAME = `${TEST_USERNAME_PREFIX}seedadmin`;
    process.env.FORGE_ADMIN_PASSWORD = 'seed-password-1234';

    const res = await seedFirstAdmin();
    expect(res.created).toBe(true);
    expect(res.username).toBe(`${TEST_USERNAME_PREFIX}seedadmin`);

    const [m] = await getDb()
      .select()
      .from(member)
      .where(sql`${member.username} = ${TEST_USERNAME_PREFIX + 'seedadmin'}`);
    expect(m.isAdmin).toBe(true);
    expect(m.avatarTint).toBe('#9a6b4f'); // default tint

    const ids = await getDb()
      .select()
      .from(memberIdentity)
      .where(sql`${memberIdentity.memberId} = ${m.id}`);
    expect(ids).toHaveLength(1);
    expect(ids[0].provider).toBe('local');
    expect(ids[0].passwordHash).toBeTruthy();
  });

  it('non-empty DB → idempotent no-op', async () => {
    // seed (or rely on an existing member) so the table is non-empty
    if ((await memberCount()) === 0) {
      process.env.FORGE_ADMIN_USERNAME = `${TEST_USERNAME_PREFIX}seedidem`;
      process.env.FORGE_ADMIN_PASSWORD = 'seed-password-1234';
      await seedFirstAdmin();
    }
    const before = await memberCount();
    const res = await seedFirstAdmin();
    expect(res.created).toBe(false);
    expect(await memberCount()).toBe(before);
  });

  it('empty DB + blank username → fail fast, creates no member', async () => {
    if ((await memberCount()) > 0) return;
    process.env.FORGE_ADMIN_USERNAME = '';
    process.env.FORGE_ADMIN_PASSWORD = 'seed-password-1234';
    await expect(seedFirstAdmin()).rejects.toThrow(/FORGE_ADMIN_USERNAME/);
    expect(await memberCount()).toBe(0);
  });

  it('empty DB + weak (sub-min) password → fail fast, creates no member', async () => {
    if ((await memberCount()) > 0) return;
    process.env.FORGE_ADMIN_USERNAME = `${TEST_USERNAME_PREFIX}weak`;
    process.env.FORGE_ADMIN_PASSWORD = 'short';
    await expect(seedFirstAdmin()).rejects.toThrow(/PASSWORD_MIN_LENGTH|weak/i);
    expect(await memberCount()).toBe(0);
  });
});
