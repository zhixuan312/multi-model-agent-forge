// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { FIXTURE_ROOT } from './fixtures';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => FIXTURE_ROOT }));

const { GET } = await import('../../app/api/journal/log/route');

function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'M', avatarTint: '#9a6b4f', isAdmin: false };
}
function req(): Request {
  return new Request('http://localhost/api/journal/log', { method: 'GET' });
}

beforeEach(() => {
  mockCaller = null;
});

describe('GET /api/journal/log', () => {
  it('unauthenticated → 401', async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(401);
  });
  it('member → 200 with parsed log entries in file order', async () => {
    mockCaller = asMember();
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.log).toHaveLength(7);
    expect(json.log[0]).toMatchObject({ op: 'create', id: '0001' });
  });
});
