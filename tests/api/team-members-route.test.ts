// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

// GET /api/teams/[id]/members — org-admin only; lists one team's roster for the
// assign-admin picker. Privacy: returns id/displayName/username/isAdmin only.
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));
const FORGE_ID = '00000000-0000-0000-0000-000000000000';
vi.mock('@/db/client', () => ({
  getDb: () =>
    createMockDb({
      'select:team_member': [
        { id: 'm1', username: 'ada', displayName: 'Ada', avatarTint: '#000', role: 'member', teamId: 'team-1', createdAt: new Date() },
        { id: FORGE_ID, username: 'forge', displayName: 'Forge', avatarTint: '#000', role: 'member', teamId: 'team-1', createdAt: new Date() },
      ],
    }),
}));

const { GET } = await import('../../app/api/teams/[id]/members/route');

function asMember(role: AuthedMember['role'], teamId: string | null): AuthedMember {
  return { id: 'caller', username: 'o', displayName: 'O', avatarTint: '#000', role, teamId };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const anyReq = () => new Request('http://localhost/api/teams/team-1/members');

describe('GET /api/teams/[id]/members', () => {
  it('401 for an anonymous caller', async () => {
    mockCaller = null;
    expect((await GET(anyReq(), ctx('team-1'))).status).toBe(401);
  });

  it('403 for a non org-admin', async () => {
    mockCaller = asMember('team_admin', 'team-1');
    expect((await GET(anyReq(), ctx('team-1'))).status).toBe(403);
  });

  it('200 lists the team roster with no identity beyond name/username', async () => {
    mockCaller = asMember('org_admin', null);
    const res = await GET(anyReq(), ctx('team-1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0].displayName).toBe('Ada');
    expect(body[0].isAdmin).toBe(false);
    expect(body[0].isSystem).toBe(false);
    expect(body[0]).not.toHaveProperty('avatarTint');
  });

  it('flags the Forge agent as a system member (not admin-eligible)', async () => {
    mockCaller = asMember('org_admin', null);
    const res = await GET(anyReq(), ctx('team-1'));
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const forge = body.find((m) => m.username === 'forge');
    expect(forge?.isSystem).toBe(true);
  });
});
