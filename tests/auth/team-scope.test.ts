// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { requireTeamScope } from '@/auth/team-scope';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/auth/current-member', () => ({
  currentMember: async () => ({ id: 'm1', username: 'alice', displayName: 'Alice', avatarTint: '#9a6b4f', role: 'team_admin', teamId: 'team-1' }),
}));

describe('requireTeamScope', () => {
  it('returns the actor and current team for a team-bound role', async () => {
    const db = createMockDb({ 'select:team': [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: null }] });
    const scope = await requireTeamScope({ db });
    expect(scope.actor.teamId).toBe('team-1');
    expect(scope.currentTeam.workspaceRootPath).toBe('/forge/base/alpha');
  });
});
