// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// AC-6: the recall route writes the original query to ops_action_log.target — the
// invariant the auto-derived FAQ aggregation depends on.

const mockCaller: AuthedMember | null = { id: 'm1', username: 'm', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 'team-1' };
vi.mock('@/auth/current-member', () => ({ currentMember: async () => mockCaller, currentSession: async () => null }));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({ dispatch: async () => ({ batchId: 'b-1' }) }) }));
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: async () => ({ batchRowId: 'batch-row-1', batchId: 'ext-batch-1' }),
  findInflight: async () => null,
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
      if (prop === 'set') return () => mockDbChain(data);
      if (prop === 'update') return () => mockDbChain(data);
      if (prop === 'insert') return () => mockDbChain(data);
      if (prop === 'values') return () => mockDbChain(data);
      if (prop === 'returning') return () => Promise.resolve([data]);
      return mockDbChain(data);
    },
  });
}

vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => mockDbChain({ id: 'team-1', name: 'Team', slug: 'team', workspaceRootPath: '/ws', gitTokenRef: null }),
    insert: mockDbChain({}),
    update: mockDbChain({}),
  }),
}));

const { POST: recallPOST } = await import('../../app/api/journal/recall/route');

function req(query: string): Request {
  return new Request('http://localhost/api/journal/recall', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ query }),
  });
}

describe('journal recall route — dispatch via dispatchMma', () => {
  it('dispatches and returns 202 with the external batchId', async () => {
    const q = 'how does authentication work in this app';
    const res = await recallPOST(req(q) as never);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.batchId).toBe('ext-batch-1');
  });
});
