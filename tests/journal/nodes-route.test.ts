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
  return new Proxy(function chainFn() { return Promise.resolve([data]); }, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.asyncIterator) return undefined;
      if (prop === 'limit') return () => Promise.resolve([data]);
      if (prop === 'where') return () => mockDbChain(data);
      if (prop === 'select') return () => mockDbChain(data);
      if (prop === 'from') return () => mockDbChain(data);
      return mockDbChain(data);
    },
  });
}

vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => mockDbChain({ id: 'team-1', name: 'Team', slug: 'team', workspaceRootPath: FIXTURE_ROOT, gitTokenRef: null }),
  }),
}));

// Spy on the reader so the id-guard test can assert it is NOT invoked.
const readNodeSpy = vi.fn();
vi.mock('@/journal/store-reader', async () => {
  const actual = await vi.importActual<typeof import('@/journal/store-reader')>(
    '@/journal/store-reader',
  );
  return {
    ...actual,
    readNode: (...a: Parameters<typeof actual.readNode>) => {
      readNodeSpy(...a);
      return actual.readNode(...a);
    },
  };
});

const { GET: nodesGET } = await import('../../app/api/journal/nodes/route');
const { GET: nodeGET } = await import('../../app/api/journal/nodes/[id]/route');

function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'M', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' };
}
function req(): Request {
  return new Request('http://localhost/api/journal/nodes', { method: 'GET' });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockCaller = null;
  readNodeSpy.mockClear();
});

describe('GET /api/journal/nodes', () => {
  it('unauthenticated → 401', async () => {
    const res = await nodesGET(req() as never);
    expect(res.status).toBe(401);
  });
  it('member → 200 with reconciled node list (file-only listed, skipped counted)', async () => {
    mockCaller = asMember();
    const res = await nodesGET(req() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe('ok');
    const ids = json.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain('0008'); // file-only
    expect(json.skippedCount).toBe(1); // unparseable 0006
  });
});

describe('GET /api/journal/nodes/[id]', () => {
  it('unauthenticated → 401', async () => {
    const res = await nodeGET(req() as never, ctx('0002'));
    expect(res.status).toBe(401);
  });

  it('valid id → node JSON + server-computed inbound edges', async () => {
    mockCaller = asMember();
    const res = await nodeGET(req() as never, ctx('0001'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.node.id).toBe('0001');
    // 0002 supersedes 0001 → inbound superseded-by 0002
    expect(json.inbound).toContainEqual({ label: 'superseded-by', source: '0002' });
  });

  it('non-4-digit id (12 / abc / ../etc) → 400 and reader NOT invoked (F12)', async () => {
    mockCaller = asMember();
    for (const bad of ['12', 'abc', '..%2Fetc']) {
      const res = await nodeGET(req() as never, ctx(bad));
      expect(res.status).toBe(400);
    }
    expect(readNodeSpy).not.toHaveBeenCalled();
  });

  it('unparseable node id → 200 with a parse-error marker (no crash)', async () => {
    mockCaller = asMember();
    const res = await nodeGET(req() as never, ctx('0006'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.node).toBeNull();
    expect(json.parseError).toBeTruthy();
  });
});
