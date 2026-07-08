// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

let mockMember: AuthedMember | null = null;
let mockDb = createMockDb();

vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockMember,
  currentSession: async () => null,
}));

vi.mock('@/db/client', () => ({
  getDb: () => mockDb,
}));

const { GET } = await import('../../app/api/usage/route');

const orgAdmin: AuthedMember = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin User',
  avatarTint: '#9a6b4f',
  role: 'org_admin',
  teamId: null,
};

const teamMember: AuthedMember = {
  id: 'member-1',
  username: 'member',
  displayName: 'Team Member',
  avatarTint: '#9a6b4f',
  role: 'member',
  teamId: 'team-1',
};

beforeEach(() => {
  mockMember = null;
  mockDb = createMockDb({
    'select:ops_mma_batch': [
      {
        id: 'batch-1',
        teamId: 'team-1',
        route: 'delegate',
        status: 'done',
        costUsd: 10.5,
        savedVsMainUsd: 5.2,
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 2000,
        implementerModel: 'claude-opus',
        reviewerModel: null,
        implementerTier: 'standard',
        createdAt: new Date(),
      },
    ],
    'select:team': [{ id: 'team-1', name: 'Team One', slug: 'team-one', workspaceRootPath: '/ws', gitTokenRef: null }],
    'select:team_member': [{ count: 3 }],
  });
});

describe('GET /api/usage', () => {
  it('returns 401 for unauthenticated request with scope=org', async () => {
    mockMember = null;
    const req = new Request('http://localhost/api/usage?scope=org');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin requesting org scope', async () => {
    mockMember = teamMember;
    const req = new Request('http://localhost/api/usage?scope=org');
    const res = await GET(req as any);
    expect(res.status).toBe(403);
  });

  it('returns org rollup for org_admin with scope=org', async () => {
    mockMember = orgAdmin;
    const req = new Request('http://localhost/api/usage?scope=org');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify response contains org-level data only (no sensitive project/repo details)
    expect(body).toHaveProperty('headline');
    expect(body).toHaveProperty('costByTeam');
    expect(body).toHaveProperty('infraBreakdown');
    expect(body).toHaveProperty('trend');

    // Verify privacy: response should NOT contain project/repo/spec names or member identities
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('projectName');
    expect(bodyStr).not.toContain('repoName');
    expect(bodyStr).not.toContain('specName');
    expect(bodyStr).not.toContain('username');
    expect(bodyStr).not.toContain('displayName');

    // Verify headline structure
    if (body.headline) {
      expect(body.headline).toHaveProperty('totalCostUsd');
      expect(body.headline).toHaveProperty('activeTeams');
      expect(body.headline).toHaveProperty('costPerMemberUsd');
    }

    // Verify costByTeam contains only teamId, teamName, memberCount, and metrics (no project/member details)
    if (Array.isArray(body.costByTeam)) {
      body.costByTeam.forEach((row: any) => {
        expect(row).toMatchObject({
          teamId: expect.any(String),
          teamName: expect.any(String),
          memberCount: expect.any(Number),
          costUsd: expect.any(Number),
        });
        expect(Object.keys(row)).not.toContain('username');
        expect(Object.keys(row)).not.toContain('displayName');
      });
    }
  });

  it('returns 200 for team member with default team scope', async () => {
    mockMember = teamMember;
    const req = new Request('http://localhost/api/usage');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Team-level response should have metrics structure
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('bySources');
    expect(body).toHaveProperty('byRoutes');
  });

  it('supports period parameter for filtering', async () => {
    mockMember = teamMember;
    const req = new Request('http://localhost/api/usage?period=30d');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  it('supports tab parameter for different views', async () => {
    mockMember = teamMember;
    const req = new Request('http://localhost/api/usage?tab=projects');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  it('rejects invalid tab parameter', async () => {
    mockMember = teamMember;
    const req = new Request('http://localhost/api/usage?tab=invalid_tab');
    const res = await GET(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_tab');
  });
});
