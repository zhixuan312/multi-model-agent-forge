// @vitest-environment node
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { session, memberIdentity } from '@/db/schema/identity';
import { resolveSessionFromToken } from '@/auth/current-member';
import { PostgresSessionStore } from '@/auth/session-store';
import { SESSION_IDLE_TTL_MS } from '@/auth/config';
import { seedTestMember, cleanupTestMembers, closeDb } from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('resolveSessionFromToken (live DB)', () => {
  const store = new PostgresSessionStore();
  let memberId: string;

  beforeAll(async () => {
    const m = await seedTestMember({ label: 'curmem' });
    memberId = m.id;
  });
  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  it('valid session → resolves the member and advances last_used_at', async () => {
    const created = await store.create(memberId);
    // backdate last_used_at so the touch is observable but still within idle TTL
    const past = new Date(Date.now() - 60_000);
    await getDb().update(session).set({ lastUsedAt: past }).where(eq(session.id, created.record.id));

    const resolved = await resolveSessionFromToken(created.token, { store });
    expect(resolved?.member.id).toBe(memberId);

    const [row] = await getDb().select().from(session).where(eq(session.id, created.record.id));
    expect(row.lastUsedAt.getTime()).toBeGreaterThan(past.getTime());
    await store.revoke(created.record.id);
  });

  it('absolute-expired session → null', async () => {
    const created = await store.create(memberId);
    await getDb()
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.id, created.record.id));
    expect(await resolveSessionFromToken(created.token, { store })).toBeNull();
    await store.revoke(created.record.id);
  });

  it('idle-expired session (last_used_at older than IDLE_TTL, expires_at still future) → rejected', async () => {
    const created = await store.create(memberId);
    const stale = new Date(Date.now() - (SESSION_IDLE_TTL_MS + 60_000));
    await getDb().update(session).set({ lastUsedAt: stale }).where(eq(session.id, created.record.id));
    expect(await resolveSessionFromToken(created.token, { store })).toBeNull();
    await store.revoke(created.record.id);
  });

  it('password rotated after session creation → session rejected', async () => {
    const created = await store.create(memberId);
    // bump password_changed_at to AFTER the session's created_at (DB clock)
    await getDb()
      .update(memberIdentity)
      .set({ passwordChangedAt: new Date(created.record.createdAt.getTime() + 1000) })
      .where(eq(memberIdentity.memberId, memberId));
    expect(await resolveSessionFromToken(created.token, { store })).toBeNull();
    // reset for other tests in this member's lifecycle
    await getDb()
      .update(memberIdentity)
      .set({ passwordChangedAt: null })
      .where(eq(memberIdentity.memberId, memberId));
    await store.revoke(created.record.id);
  });

  it('missing / empty token → null', async () => {
    expect(await resolveSessionFromToken(undefined, { store })).toBeNull();
    expect(await resolveSessionFromToken('', { store })).toBeNull();
  });
});
