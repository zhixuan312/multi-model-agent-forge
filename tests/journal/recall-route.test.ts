// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const dispatchCalls: unknown[] = [];
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: async (opts: unknown) => { dispatchCalls.push(opts); return { batchRowId: 'batch-row-1', batchId: 'ext-batch-1' }; },
  findInflight: async () => null,
}));

vi.mock('@/mma/server-client', () => ({
  buildMmaClient: async () => ({ dispatch: async () => ({ batchId: 'b-1' }) }),
}));

vi.mock('@/observability/action-log', () => ({ logAction: async () => {} }));

function mockDbChain(data: unknown) {
  return new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.asyncIterator) return undefined;
      if (prop === 'limit') return () => [data];
      if (prop === 'where') return () => mockDbChain(data);
      if (prop === 'select') return () => mockDbChain(data);
      if (prop === 'from') return () => mockDbChain(data);
      if (prop === 'transaction') return (fn: any) => fn(mockDbChain(data));
      return mockDbChain(data);
    },
    apply() { return Promise.resolve([data]); },
  });
}

vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => mockDbChain({ id: 'team-1', name: 'Team', slug: 'team', workspaceRootPath: '/workspace', gitTokenRef: null }),
    insert: mockDbChain({}),
    update: mockDbChain({}),
  }),
}));

const { POST } = await import('../../app/api/journal/recall/route');

function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'Member', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' };
}

function recallReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/journal/recall', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCaller = null;
  dispatchCalls.length = 0;
});

describe('POST /api/journal/recall', () => {
  it('unauthenticated → 401 BEFORE any dispatch (F16)', async () => {
    mockCaller = null;
    const res = await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    expect(res.status).toBe(401);
    expect(dispatchCalls).toHaveLength(0);
  });

  it('cross-origin → 403 BEFORE any dispatch (CSRF, F13)', async () => {
    mockCaller = asMember();
    const res = await POST(
      recallReq({ query: 'how do we gate completion?' }, { 'sec-fetch-site': 'cross-site' }) as never,
    );
    expect(res.status).toBe(403);
    expect(dispatchCalls).toHaveLength(0);
  });

  it('authenticated non-admin valid query → dispatch via dispatchMma → 202 external batchId', async () => {
    mockCaller = asMember();
    const res = await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toEqual({ batchId: 'ext-batch-1' }); // external MMA id (fire-and-row-poll), not the DB row id
    expect(dispatchCalls).toHaveLength(1);
    const opts = dispatchCalls[0] as Record<string, unknown>;
    expect(opts.route).toBe('journal_recall');
    expect(opts.handler).toBeNull(); // fire-and-row-poll — no terminal handler
    expect(opts.label).toBe('journal-recall'); // trace label on the row
    expect(opts.projectId).toBeNull();
  });

  it('dispatchMma receives the query in body and actorId from the authenticated member', async () => {
    mockCaller = asMember();
    await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    const opts = dispatchCalls[0] as Record<string, unknown>;
    expect(opts.actorId).toBe('m-x');
    expect((opts.body as Record<string, unknown>).prompt).toBe('how do we gate completion?');
  });

  it('trimmed query < 10 → 400, no dispatch', async () => {
    mockCaller = asMember();
    const short = await POST(recallReq({ query: 'too short' }) as never);
    expect(short.status).toBe(400);
    const trimmed = await POST(recallReq({ query: '          short   ' }) as never);
    expect(trimmed.status).toBe(400);
    expect(dispatchCalls).toHaveLength(0);
  });

  it('trimmed query > 4000 → 400, no dispatch', async () => {
    mockCaller = asMember();
    const res = await POST(recallReq({ query: 'a'.repeat(4001) }) as never);
    expect(res.status).toBe(400);
    expect(dispatchCalls).toHaveLength(0);
  });
});
