// @vitest-environment node
import {
  PostgresSessionStore,
  deleteExpiredSessions,
  type SessionStore,
  type CreatedSession,
} from '@/auth/session-store';
import { hashToken } from '@/auth/cookie';
import { SESSION_ABSOLUTE_TTL_MS } from '@/auth/config';
import { createMockDb } from '../test-utils/mock-db';
import { createBaseSession } from '../test-utils/factories';

// Backend tests run on a mocked Drizzle `Db` (the gumi convention) — no database.
describe('PostgresSessionStore (mock DB)', () => {
  it('create stores the sha256 token HASH (never the raw token) and returns the token', async () => {
    const row = createBaseSession({ id: 's1' });
    const db = createMockDb({ 'insert:team_session': [row] });
    const store = new PostgresSessionStore(db);
    const created = await store.create('m1');

    expect(created.token).toBeTruthy();
    expect(created.record.id).toBe('s1');
    const values = db._callsFor('team_session').find((c) => c.method === 'values');
    const inserted = (values?.args[0] ?? {}) as { tokenHash?: string };
    expect(inserted.tokenHash).toBe(hashToken(created.token)); // hashed
    expect(inserted.tokenHash).not.toBe(created.token); // not the raw token
  });

  it('get returns the record for a live session, null when absolute-expired or unknown', async () => {
    const live = createBaseSession({ id: 's1', expiresAt: new Date(Date.now() + 60_000) });
    expect((await new PostgresSessionStore(createMockDb({ 'select:team_session': [live] })).get('t'))?.id).toBe('s1');

    const dead = createBaseSession({ id: 's2', expiresAt: new Date(Date.now() - 1000) });
    expect(await new PostgresSessionStore(createMockDb({ 'select:team_session': [dead] })).get('t')).toBeNull();

    expect(await new PostgresSessionStore(createMockDb({ 'select:team_session': [] })).get('t')).toBeNull();
  });

  it('touch updates the row; revoke deletes it', async () => {
    const touchDb = createMockDb();
    await new PostgresSessionStore(touchDb).touch('s1');
    expect(touchDb._assertCalled('team_session', 'update')).toBe(true);

    const revokeDb = createMockDb();
    await new PostgresSessionStore(revokeDb).revoke('s1');
    expect(revokeDb._assertCalled('team_session', 'delete')).toBe(true);
  });

  it('deleteExpiredSessions (reaper) returns the count of removed rows', async () => {
    const db = createMockDb({ 'delete:team_session': [{ id: 'a' }, { id: 'b' }] });
    expect(await deleteExpiredSessions(db)).toBe(2);
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
