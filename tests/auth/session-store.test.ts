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

  /**
   * The bound values of the statement's WHERE, flattened. Drizzle chunks reference their
   * table (and so themselves), hence the seen-set — same walk as
   * `automation/lease-stale-threshold.test.ts`.
   */
  function whereValues(db: ReturnType<typeof createMockDb>): string[] {
    const seen = new WeakSet<object>();
    const out: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || v === undefined) return;
      if (typeof v !== 'object') { out.push(String(v)); return; }
      if (seen.has(v)) return;
      seen.add(v);
      if (v.constructor?.name?.startsWith('Pg')) return;
      for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    for (const c of db._calls.filter((c) => c.method === 'where')) walk(c.args);
    return out;
  }

  /**
   * These asserted only that an update / a delete RAN. `revoke` deletes from a table of
   * every session in the product, so "a delete ran" is also true of a `revoke` with no
   * predicate at all — which signs out every member of every team. The scoping is the
   * entire behaviour; the verb is not.
   */
  it('touch updates only the named session', async () => {
    const db = createMockDb();
    await new PostgresSessionStore(db).touch('s1');
    expect(db._wasCalled('team_session', 'update')).toBe(true);
    expect(whereValues(db), 'touch is not scoped to one session').toContain('s1');
  });

  it('revoke deletes only the named session', async () => {
    const db = createMockDb();
    await new PostgresSessionStore(db).revoke('s1');
    expect(db._wasCalled('team_session', 'delete')).toBe(true);
    expect(whereValues(db), 'an unscoped revoke signs out every member').toContain('s1');
  });

  /**
   * The Postgres WHERE clauses of these two were untested: `members-core.test.ts` and
   * `change-password-core.test.ts` assert that the CALLER invokes them with the right
   * arguments, against a stubbed store. Nothing checked that the real implementation
   * turns those arguments into predicates.
   */
  it('revokeAllForMember scopes to that member, not to every session', async () => {
    const db = createMockDb();
    await new PostgresSessionStore(db).revokeAllForMember('m1');
    expect(whereValues(db)).toContain('m1');
  });

  it('revokeAllForMemberExcept keeps the caller’s own session', async () => {
    // Password change signs out the other devices. Losing the `except` predicate signs
    // out the person who just changed it, on the request that changed it.
    const db = createMockDb();
    await new PostgresSessionStore(db).revokeAllForMemberExcept('m1', 's-current');
    const values = whereValues(db);
    expect(values).toContain('m1');
    expect(values, 'the surviving session is not named — the caller would be signed out too').toContain('s-current');
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
