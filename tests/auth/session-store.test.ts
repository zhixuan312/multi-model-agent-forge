// @vitest-environment node
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { session } from '@/db/schema/identity';
import {
  PostgresSessionStore,
  deleteExpiredSessions,
  type SessionStore,
  type CreatedSession,
} from '@/auth/session-store';
import { hashToken } from '@/auth/cookie';
import { SESSION_ABSOLUTE_TTL_MS } from '@/auth/config';
import { seedTestMember, cleanupTestMembers, closeDb } from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('PostgresSessionStore (live DB)', () => {
  const store: SessionStore = new PostgresSessionStore();
  let memberId: string;

  beforeAll(async () => {
    const m = await seedTestMember({ label: 'session' });
    memberId = m.id;
  });
  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  it('create stores the sha256 hash (not the raw token) and sets expires_at ≈ created_at + ABSOLUTE_TTL', async () => {
    const created: CreatedSession = await store.create(memberId);
    expect(created.token).toBeTruthy();
    // the stored token_hash is sha256(token), never the raw token
    expect(created.record.tokenHash).toBe(hashToken(created.token));
    expect(created.record.tokenHash).not.toBe(created.token);

    const lifetime = created.record.expiresAt.getTime() - created.record.createdAt.getTime();
    // within a 5s clock tolerance of the absolute TTL
    expect(Math.abs(lifetime - SESSION_ABSOLUTE_TTL_MS)).toBeLessThan(5000);
    await store.revoke(created.record.id);
  });

  it('get returns the session for a valid token, null for an unknown token', async () => {
    const created = await store.create(memberId);
    const got = await store.get(created.token);
    expect(got?.id).toBe(created.record.id);
    expect(await store.get('not-a-real-token')).toBeNull();
    await store.revoke(created.record.id);
  });

  it('get returns null for an absolute-expired session', async () => {
    const created = await store.create(memberId);
    // force expires_at into the past
    await getDb()
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.id, created.record.id));
    expect(await store.get(created.token)).toBeNull();
    await store.revoke(created.record.id);
  });

  it('touch slides last_used_at forward', async () => {
    const created = await store.create(memberId);
    // backdate last_used_at so the touch is observable
    const past = new Date(Date.now() - 60_000);
    await getDb().update(session).set({ lastUsedAt: past }).where(eq(session.id, created.record.id));
    await store.touch(created.record.id);
    const [row] = await getDb().select().from(session).where(eq(session.id, created.record.id));
    expect(row.lastUsedAt.getTime()).toBeGreaterThan(past.getTime());
    await store.revoke(created.record.id);
  });

  it('revoke removes the row → subsequent get is null (logout/revocation)', async () => {
    const created = await store.create(memberId);
    await store.revoke(created.record.id);
    expect(await store.get(created.token)).toBeNull();
  });

  it('revokeAllForMemberExcept drops other sessions but keeps the named one', async () => {
    const keep = await store.create(memberId);
    const drop = await store.create(memberId);
    await store.revokeAllForMemberExcept(memberId, keep.record.id);
    expect(await store.get(keep.token)).not.toBeNull();
    expect(await store.get(drop.token)).toBeNull();
    await store.revoke(keep.record.id);
  });

  it('deleteExpiredSessions (reaper) removes expired rows; a live row survives', async () => {
    const live = await store.create(memberId);
    const dead = await store.create(memberId);
    await getDb()
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.id, dead.record.id));
    await deleteExpiredSessions();
    expect(await store.get(live.token)).not.toBeNull();
    const [deadRow] = await getDb().select().from(session).where(eq(session.id, dead.record.id));
    expect(deadRow).toBeUndefined();
    await store.revoke(live.record.id);
  });
});

// Interface-boundary proof: a second in-memory SessionStore impl satisfies the
// same contract with no call-site change (the future Redis swap).
class FakeSessionStore implements SessionStore {
  private rows = new Map<string, { memberId: string; tokenHash: string; lastUsedAt: Date; expiresAt: Date; createdAt: Date }>();
  private counter = 0;
  async create(memberId: string, opts?: { token?: string }): Promise<CreatedSession> {
    const token = opts?.token ?? `tok-${++this.counter}`;
    const id = `s-${this.counter}`;
    const now = new Date();
    const rec = {
      memberId,
      tokenHash: hashToken(token),
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
      createdAt: now,
    };
    this.rows.set(id, rec);
    return { token, record: { id, ...rec } };
  }
  async get(token: string): Promise<ReturnType<SessionStore['get']> extends Promise<infer T> ? T : never> {
    const hash = hashToken(token);
    for (const [id, r] of this.rows) {
      if (r.tokenHash === hash) {
        if (r.expiresAt.getTime() <= Date.now()) return null;
        return { id, ...r };
      }
    }
    return null;
  }
  async touch(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.lastUsedAt = new Date();
  }
  async revoke(id: string): Promise<void> {
    this.rows.delete(id);
  }
  async revokeAllForMemberExcept(memberId: string, except: string): Promise<void> {
    for (const [id, r] of [...this.rows]) if (r.memberId === memberId && id !== except) this.rows.delete(id);
  }
  async revokeAllForMember(memberId: string): Promise<void> {
    for (const [id, r] of [...this.rows]) if (r.memberId === memberId) this.rows.delete(id);
  }
}

describe('SessionStore interface seam (fake impl, no call-site change)', () => {
  it('a second impl satisfies create/get/touch/revoke', async () => {
    const store: SessionStore = new FakeSessionStore();
    const created = await store.create('member-x');
    expect((await store.get(created.token))?.id).toBe(created.record.id);
    await store.revoke(created.record.id);
    expect(await store.get(created.token)).toBeNull();
  });
});
