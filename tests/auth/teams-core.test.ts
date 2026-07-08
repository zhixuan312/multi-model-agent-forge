// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTeam, assignTeamAdmin } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

describe('teams-core', () => {
  it('creates a team with slug and workspace root', async () => {
    const db = createMockDb({
      'insert:team': [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: null, createdAt: new Date(), updatedAt: new Date() }],
    });
    const res = await createTeam({ name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha' }, { db });
    expect(res.kind).toBe('created');
  });

  it('assigns the chosen member as team_admin for the target team only', async () => {
    const db = createMockDb({
      'select:team_member': [{ id: 'member-1', role: 'member', teamId: 'team-1' }],
      'update:team_member': [{ id: 'member-1' }],
    });
    const res = await assignTeamAdmin('team-1', 'member-1', { db });
    expect(res.kind).toBe('assigned');
  });
});
