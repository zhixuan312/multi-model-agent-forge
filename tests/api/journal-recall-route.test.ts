// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// AC-6: the recall route writes the original query to ops_action_log.target — the
// invariant the auto-derived FAQ aggregation depends on.

let mockCaller: AuthedMember | null = { id: 'm1', username: 'm', displayName: 'M', avatarTint: '#000', isAdmin: false };
vi.mock('@/auth/current-member', () => ({ currentMember: async () => mockCaller, currentSession: async () => null }));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({}) }));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/ws' }));
vi.mock('@/journal/recall', () => ({ dispatchRecall: async () => ({ batchId: 'b-1' }) }));
const logAction = vi.fn(async () => {});
vi.mock('@/observability/action-log', () => ({ logAction }));

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

const { POST: recallPOST } = await import('../../app/api/journal/recall/route');

function req(query: string): Request {
  return new Request('http://localhost/api/journal/recall', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ query }),
  });
}

describe('journal recall route — FAQ invariant', () => {
  it('logs action=journal_recall with target = the original query', async () => {
    const q = 'how does authentication work in this app';
    const res = await recallPOST(req(q) as never);
    expect(res.status).toBe(202);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'journal_recall', target: q }));
  });
});
