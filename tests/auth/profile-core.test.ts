// @vitest-environment node
import { updateOwnProfile, getProfileMeta, updateProfileSchema } from '@/auth/profile-core';
import { createMockDb } from '../test-utils/mock-db';

// Backend tests run on a mocked Drizzle `Db` (the gumi convention) — no database.

describe('updateProfileSchema (input contract)', () => {
  it('accepts a non-empty display name + a 6-digit hex tint, trimming the name', () => {
    const r = updateProfileSchema.safeParse({ displayName: '  Ada  ', avatarTint: '#9a6b4f' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.displayName).toBe('Ada');
    expect(updateProfileSchema.safeParse({ displayName: 'Ada', avatarTint: '#ABCDEF' }).success).toBe(true);
  });

  it('rejects an empty name and any non-#rrggbb tint', () => {
    expect(updateProfileSchema.safeParse({ displayName: '   ', avatarTint: '#9a6b4f' }).success).toBe(false);
    for (const bad of ['#abc', '9a6b4f', '#9a6b4', '#zzzzzz', 'red']) {
      expect(updateProfileSchema.safeParse({ displayName: 'Ada', avatarTint: bad }).success).toBe(false);
    }
  });
});

describe('updateOwnProfile', () => {
  it('rejects invalid input with no DB write', async () => {
    const db = createMockDb();
    expect((await updateOwnProfile('m1', { displayName: '', avatarTint: 'bad' }, { db })).kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });

  it('not_found when the member row is missing', async () => {
    const db = createMockDb({ 'update:iam_member': [] });
    expect((await updateOwnProfile('m1', { displayName: 'Ada', avatarTint: '#9a6b4f' }, { db })).kind).toBe('not_found');
  });

  it('updates the member and echoes the persisted values', async () => {
    const db = createMockDb({ 'update:iam_member': [{ displayName: 'Ada', avatarTint: '#123456' }] });
    const res = await updateOwnProfile('m1', { displayName: 'Ada', avatarTint: '#123456' }, { db });
    expect(res).toEqual({ kind: 'updated', displayName: 'Ada', avatarTint: '#123456' });
    expect(db._assertCalled('iam_member', 'update')).toBe(true);
  });
});

describe('getProfileMeta', () => {
  it('returns created-at + the active-session count', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const db = createMockDb({ iam_member: [{ createdAt }], iam_session: [{ n: 3 }] });
    expect(await getProfileMeta('m1', { db })).toEqual({ createdAt, activeSessions: 3 });
  });

  it('defaults to null + 0 when nothing is found', async () => {
    const db = createMockDb();
    expect(await getProfileMeta('m1', { db })).toEqual({ createdAt: null, activeSessions: 0 });
  });
});
