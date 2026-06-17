// @vitest-environment node
import { vi } from 'vitest';
import { resolveSessionFromToken } from '@/auth/current-member';
import type { SessionStore } from '@/auth/session-store';
import { SESSION_IDLE_TTL_MS } from '@/auth/config';
import { createMockDb } from '../test-utils/mock-db';
import { createBaseSession, createBaseMember } from '../test-utils/factories';

// resolveSessionFromToken is dependency-injected (store + db + now) and tests run
// on mocks — no database (the gumi convention).
const NOW = new Date('2026-06-01T00:00:00.000Z').getTime();
const memberRow = (over = {}) => ({ ...createBaseMember({ id: 'm1' }), passwordChangedAt: null, ...over });

function store(sess: ReturnType<typeof createBaseSession> | null) {
  return {
    get: vi.fn(async () => sess),
    touch: vi.fn(async () => {}),
  } as unknown as SessionStore;
}

describe('resolveSessionFromToken', () => {
  it('returns null for a missing token without hitting the store', async () => {
    const st = store(null);
    expect(await resolveSessionFromToken('', { store: st, db: createMockDb(), now: () => NOW })).toBeNull();
    expect(st.get).not.toHaveBeenCalled();
  });

  it('returns null when the store has no live session', async () => {
    expect(await resolveSessionFromToken('t', { store: store(null), db: createMockDb(), now: () => NOW })).toBeNull();
  });

  it('rejects an idle-expired session', async () => {
    const sess = createBaseSession({ lastUsedAt: new Date(NOW - SESSION_IDLE_TTL_MS - 1000) });
    expect(await resolveSessionFromToken('t', { store: store(sess), db: createMockDb(), now: () => NOW })).toBeNull();
  });

  it('rejects when the member is gone', async () => {
    const sess = createBaseSession({ lastUsedAt: new Date(NOW - 1000) });
    const db = createMockDb({ 'select:team_member': [] });
    expect(await resolveSessionFromToken('t', { store: store(sess), db, now: () => NOW })).toBeNull();
  });

  it('rejects when the password was rotated after the session was created', async () => {
    const sess = createBaseSession({ createdAt: new Date(NOW - 10_000), lastUsedAt: new Date(NOW - 1000) });
    const db = createMockDb({ 'select:team_member': [memberRow({ passwordChangedAt: new Date(NOW - 5000) })] });
    expect(await resolveSessionFromToken('t', { store: store(sess), db, now: () => NOW })).toBeNull();
  });

  it('resolves a valid session and slides the idle window', async () => {
    const sess = createBaseSession({ id: 's1', createdAt: new Date(NOW - 10_000), lastUsedAt: new Date(NOW - 1000) });
    const st = store(sess);
    const db = createMockDb({ 'select:team_member': [memberRow({ passwordChangedAt: null })] });
    const res = await resolveSessionFromToken('t', { store: st, db, now: () => NOW });
    expect(res?.member.id).toBe('m1');
    expect(st.touch).toHaveBeenCalledWith('s1');
  });
});
