// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

let mockMember: AuthedMember | null = null;
const seedDb = () =>
  createMockDb({
    'select:team': [{ id: 'team-1', name: 'Team', slug: 'team', workspaceRootPath: '/workspace', gitTokenRef: null }],
    'select:team_member': [], // admin username pre-check: none existing
    'insert:team': [{ id: 'team-1', name: 'Team 1', slug: 'team-1', workspaceRootPath: '/workspace', gitTokenRef: null, createdAt: new Date(), updatedAt: new Date() }],
    'insert:team_member': [{ id: 'ta-1', username: 'lead', displayName: 'Lead' }],
  });
let mockDb = seedDb();

vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockMember,
}));

vi.mock('@/db/client', () => ({
  getDb: () => mockDb,
}));

const { GET: getTeams, POST: postTeam } = await import('../../app/api/teams/route');

const orgAdmin: AuthedMember = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin',
  avatarTint: '#9a6b4f',
  role: 'org_admin',
  teamId: null,
};

const member: AuthedMember = {
  id: 'member-1',
  username: 'member',
  displayName: 'Member',
  avatarTint: '#9a6b4f',
  role: 'member',
  teamId: 'team-1',
};

beforeEach(() => {
  mockDb = seedDb();
});

describe('Teams API routes', () => {
  it('GET /api/teams returns 401 for unauthenticated', async () => {
    mockMember = null;
    const res = await getTeams();
    expect(res.status).toBe(401);
  });

  it('GET /api/teams returns 403 for non-org-admin', async () => {
    mockMember = member;
    const res = await getTeams();
    expect(res.status).toBe(403);
  });

  it('POST /api/teams creates the team + its admin (201) for org-admin', async () => {
    mockMember = orgAdmin;
    const req = new Request('http://localhost/api/teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'team-1',
        workspaceRootPath: '/workspace',
        admin: { displayName: 'Lead', username: 'lead', password: 'a-strong-password' },
      }),
    });
    const res = await postTeam(req as any);
    expect(res.status).toBe(201);
  });

  it('POST /api/teams returns 400 when the admin block is missing', async () => {
    mockMember = orgAdmin;
    const req = new Request('http://localhost/api/teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'team-1', workspaceRootPath: '/workspace' }),
    });
    const res = await postTeam(req as any);
    expect(res.status).toBe(400);
  });
});
