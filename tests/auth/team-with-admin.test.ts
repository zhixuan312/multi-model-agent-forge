// @vitest-environment node
import { createTeamWithAdmin } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

// Backend tests run on a mocked Drizzle `Db` — no database is touched.
const STRONG = 'a-strong-password';
const teamRow = { id: 'team-9', name: 'Beta', slug: 'beta', workspaceRootPath: '/forge/base/beta', gitTokenRef: null };
const adminRow = { id: 'ta9', username: 'bianca', displayName: 'Bianca' };

describe('createTeamWithAdmin', () => {
  it('creates the team and its team_admin member + identity together', async () => {
    const db = createMockDb({
      'select:team_member': [], // username pre-check: none existing
      'insert:team': [teamRow],
      'insert:team_member': [adminRow],
    });
    const res = await createTeamWithAdmin(
      {
        name: 'Beta',
        slug: 'beta',
        workspaceRootPath: '/forge/base/beta',
        admin: { displayName: 'Bianca', username: 'bianca', password: STRONG },
      },
      { db },
    );

    expect(res.kind).toBe('created');
    if (res.kind !== 'created') return;
    expect(res.team.id).toBe('team-9');
    expect(res.admin.username).toBe('bianca');
    expect(db._assertCalled('team', 'insert')).toBe(true);
    expect(db._assertCalled('team_member', 'insert')).toBe(true);
    expect(db._assertCalled('team_identity', 'insert')).toBe(true);

    // the member is inserted as a team_admin bound to the freshly created team
    const mv = db._callsFor('team_member').find((c) => c.method === 'values');
    expect(JSON.stringify(mv?.args)).toContain('team_admin');
    expect(JSON.stringify(mv?.args)).toContain('team-9');
    // password stored hashed, never plaintext
    const iv = db._callsFor('team_identity').find((c) => c.method === 'values');
    expect(JSON.stringify(iv?.args)).not.toContain(STRONG);
  });

  it('rejects invalid input (weak admin password) with no DB writes', async () => {
    const db = createMockDb();
    const res = await createTeamWithAdmin(
      { name: 'B', slug: 'b', workspaceRootPath: '/x', admin: { displayName: 'X', username: 'x', password: 'short' } },
      { db },
    );
    expect(res.kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });

  it('returns duplicate_username when the admin username already exists (no team created)', async () => {
    const db = createMockDb({ 'select:team_member': [{ id: 'existing' }] });
    const res = await createTeamWithAdmin(
      { name: 'B', slug: 'b', workspaceRootPath: '/forge/base/b', admin: { displayName: 'X', username: 'EXISTS', password: STRONG } },
      { db },
    );
    expect(res.kind).toBe('duplicate_username');
    expect(db._assertCalled('team', 'insert')).toBe(false);
  });
});
