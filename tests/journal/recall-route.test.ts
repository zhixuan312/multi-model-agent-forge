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
  dispatchMma: async (opts: unknown) => { dispatchCalls.push(opts); return { batchRowId: 'batch-row-1' }; },
  findInflight: async () => null,
}));

vi.mock('@/mma/server-client', () => ({
  buildMmaClient: async () => ({ dispatch: async () => ({ batchId: 'b-1' }) }),
}));

vi.mock('@/observability/action-log', () => ({ logAction: async () => {} }));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/workspace' }));

function noopChain(): unknown {
  return new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'catch') return () => Promise.resolve();
      return noopChain;
    },
    apply() { return noopChain(); },
  });
}
vi.mock('@/db/client', () => ({
  getDb: () => ({ insert: noopChain, select: noopChain, update: noopChain }),
}));

const { POST } = await import('../../app/api/journal/recall/route');

function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'Member', avatarTint: '#9a6b4f', isAdmin: false };
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

  it('authenticated non-admin valid query → dispatch via dispatchMma → 202 batchRowId', async () => {
    mockCaller = asMember();
    const res = await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toEqual({ batchRowId: 'batch-row-1' });
    expect(dispatchCalls).toHaveLength(1);
    const opts = dispatchCalls[0] as Record<string, unknown>;
    expect(opts.route).toBe('journal_recall');
    expect(opts.handler).toBe('journal-recall');
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
