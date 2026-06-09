// @vitest-environment node
import { changeOwnPassword } from '@/auth/change-password-core';
import { resolveSessionFromToken } from '@/auth/current-member';
import { PostgresSessionStore } from '@/auth/session-store';
import { verifyPassword } from '@/auth/password';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { memberIdentity } from '@/db/schema/identity';
import { seedTestMember, cleanupTestMembers, closeDb } from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('changeOwnPassword (live DB, F11/F19)', () => {
  const store = new PostgresSessionStore();
  let memberId: string;
  const CURRENT = 'current-password-1234';

  beforeEach(async () => {
    const m = await seedTestMember({ label: 'chpass', password: CURRENT });
    memberId = m.id;
  });
  afterEach(async () => {
    await cleanupTestMembers();
  });
  afterAll(async () => {
    await closeDb();
  });

  it('wrong current password → rejected, hash unchanged', async () => {
    const before = await currentHash(memberId);
    const res = await changeOwnPassword(
      { memberId, currentPassword: 'wrong', newPassword: 'new-password-1234' },
      { store },
    );
    expect(res.kind).toBe('wrong_current_password');
    expect(await currentHash(memberId)).toBe(before);
  });

  it('below-min new password → invalid_new_password (400-equivalent)', async () => {
    const res = await changeOwnPassword(
      { memberId, currentPassword: CURRENT, newPassword: 'short' },
      { store },
    );
    expect(res.kind).toBe('invalid_new_password');
  });

  it('valid change: caller is re-issued a fresh valid session; OTHER sessions drop', async () => {
    // two pre-existing sessions for this member: the calling device + another device
    const caller = await store.create(memberId);
    const otherDevice = await store.create(memberId);

    const res = await changeOwnPassword(
      { memberId, currentPassword: CURRENT, newPassword: 'brand-new-password-9999', currentSessionId: caller.record.id },
      { store },
    );
    expect(res.kind).toBe('success');
    if (res.kind !== 'success') return;

    // the freshly issued token resolves to a VALID session (caller stays logged in)
    const fresh = await resolveSessionFromToken(res.token, { store });
    expect(fresh?.member.id).toBe(memberId);

    // the OTHER device's pre-existing session is now rejected
    expect(await resolveSessionFromToken(otherDevice.token, { store })).toBeNull();
    // the caller's OLD session is also gone (only the re-issued one survives)
    expect(await resolveSessionFromToken(caller.token, { store })).toBeNull();

    // the new password verifies; the old one does not
    const hash = await currentHash(memberId);
    expect(await verifyPassword('brand-new-password-9999', hash!)).toBe(true);
    expect(await verifyPassword(CURRENT, hash!)).toBe(false);
  });

  async function currentHash(id: string): Promise<string | null> {
    const [row] = await getDb()
      .select({ h: memberIdentity.passwordHash })
      .from(memberIdentity)
      .where(and(eq(memberIdentity.memberId, id), eq(memberIdentity.provider, 'local')))
      .limit(1);
    return row?.h ?? null;
  }
});
