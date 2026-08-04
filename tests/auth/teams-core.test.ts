// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assignTeamAdmin } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

/**
 * `assignTeamAdmin` grants team_admin. The tenancy check that makes it safe —
 * `target.teamId !== teamId → not_found` — had no test at all: the file asserted only the
 * happy path under a title claiming "for the target team only". Delete that line and the
 * suite stayed green while a team admin could promote a member of ANOTHER team into their
 * own admin role.
 *
 * The route (`/api/teams/[id]/assign-admin`) authenticates the caller; it does not check
 * that the member being promoted belongs to the team named in the path. That check lives
 * here, so it is tested here.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'member-1', role: 'member', teamId: 'team-1', ...over,
});

describe('assignTeamAdmin', () => {
  it('assigns the chosen member as team_admin for their own team', async () => {
    const db = createMockDb({
      'select:team_member': [row()],
      'update:team_member': [{ id: 'member-1' }],
    });
    await expect(assignTeamAdmin('team-1', 'member-1', { db })).resolves.toEqual({ kind: 'assigned' });
    const set = db._callsFor('team_member').find((c) => c.method === 'set');
    expect(set?.args[0]).toMatchObject({ role: 'team_admin' });
  });

  it('refuses a member who belongs to a different team, and writes nothing', async () => {
    const db = createMockDb({ 'select:team_member': [row({ teamId: 'team-2' })] });
    await expect(assignTeamAdmin('team-1', 'member-1', { db })).resolves.toEqual({ kind: 'not_found' });
    expect(
      db._wasCalled('team_member', 'update'),
      'a foreign member was promoted into this team’s admin role',
    ).toBe(false);
  });

  /** `not_found`, not a distinct "no such member" — the two are deliberately indistinguishable
   *  to a caller, so probing ids cannot enumerate the org's membership. */
  it('refuses an unknown member id', async () => {
    const db = createMockDb({ 'select:team_member': [] });
    await expect(assignTeamAdmin('team-1', 'nobody', { db })).resolves.toEqual({ kind: 'not_found' });
    expect(db._wasCalled('team_member', 'update')).toBe(false);
  });

  /** A teamless member (an org admin) is not in any team, so cannot be that team's admin. */
  it('refuses a member with no team', async () => {
    const db = createMockDb({ 'select:team_member': [row({ teamId: null })] });
    await expect(assignTeamAdmin('team-1', 'member-1', { db })).resolves.toEqual({ kind: 'not_found' });
    expect(db._wasCalled('team_member', 'update')).toBe(false);
  });
});
