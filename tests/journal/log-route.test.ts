// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { FIXTURE_ROOT } from './fixtures';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));
vi.mock('@/git/workspace-root', () => ({
  resolveWorkspaceRoot: () => FIXTURE_ROOT,
  resolveTeamWorkspaceRoot: (t: { workspaceRootPath: string }) => t.workspaceRootPath,
}));

function mockDbChain(data: unknown) {
  return new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.asyncIterator) return undefined;
      if (prop === 'limit') return () => [data];
      if (prop === 'where') return () => mockDbChain(data);
      if (prop === 'select') return () => mockDbChain(data);
      if (prop === 'from') return () => mockDbChain(data);
      return mockDbChain(data);
    },
    apply() { return Promise.resolve([data]); },
  });
}

vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => mockDbChain({ id: 'team-1', name: 'Team', slug: 'team', workspaceRootPath: FIXTURE_ROOT, gitTokenRef: null }),
  }),
}));

const { GET } = await import('../../app/api/journal/log/route');

function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'M', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' };
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
  it('member → 200 with parsed log entries from team workspace root', async () => {
    mockCaller = asMember();
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.log).toHaveLength(7);
    expect(json.log[0]).toMatchObject({ op: 'create', id: '0001' });
  });
});
