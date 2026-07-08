// @vitest-environment node
import { vi, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

// Team-admin-gate contract for PUT /api/team/workspace. The gate (401 anon /
// 403 non-team-admin) short-circuits before any DB access; the authenticated
// path validates FR-8 and persists to the team row.
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));
vi.mock('@/db/client', () => ({ getDb: () => createMockDb({ 'update:team': [{}] }) }));

const { PUT } = await import('../../app/api/team/workspace/route');

function asMember(role: AuthedMember['role'], teamId: string | null): AuthedMember {
  return { id: 'm1', username: 'u', displayName: 'U', avatarTint: '#000', role, teamId };
}
function req(body: unknown): NextRequest {
  return new Request('http://localhost/api/team/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

afterEach(() => {
  mockCaller = null;
  delete process.env.FORGE_WORKSPACE_BASE;
});

describe('PUT /api/team/workspace', () => {
  it('401 for an anonymous caller', async () => {
    mockCaller = null;
    expect((await PUT(req({ workspaceRootPath: '/x' }))).status).toBe(401);
  });

  it('403 for a plain member', async () => {
    mockCaller = asMember('member', 'team-1');
    expect((await PUT(req({ workspaceRootPath: '/x' }))).status).toBe(403);
  });

  it('403 for an org_admin (not a team admin)', async () => {
    mockCaller = asMember('org_admin', null);
    expect((await PUT(req({ workspaceRootPath: '/x' }))).status).toBe(403);
  });

  it('400 when the team_admin submits a path that escapes the base', async () => {
    process.env.FORGE_WORKSPACE_BASE = '/forge/base';
    mockCaller = asMember('team_admin', 'team-1');
    expect((await PUT(req({ workspaceRootPath: '/etc/evil' }))).status).toBe(400);
  });

  it('200 and returns the resolved path for a valid sibling child', async () => {
    process.env.FORGE_WORKSPACE_BASE = '/forge/base';
    mockCaller = asMember('team_admin', 'team-1');
    const res = await PUT(req({ workspaceRootPath: '/forge/base/alpha' }));
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceRootPath).toBe('/forge/base/alpha');
  });
});
