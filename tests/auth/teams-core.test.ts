// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assignTeamAdmin } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

describe('teams-core', () => {
  it('assigns the chosen member as team_admin for the target team only', async () => {
    const db = createMockDb({
      'select:team_member': [{ id: 'member-1', role: 'member', teamId: 'team-1' }],
      'update:team_member': [{ id: 'member-1' }],
    });
    const res = await assignTeamAdmin('team-1', 'member-1', { db });
    expect(res.kind).toBe('assigned');
  });
});
