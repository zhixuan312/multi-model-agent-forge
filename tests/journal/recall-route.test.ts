// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// ── Mocks (registered BEFORE importing the handler) ──
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const journalRecall = vi.fn(async (_cwd: string, _input: { query: string }) => ({
  batchId: 'b-recall-1',
}));
vi.mock('@/mma/server-client', () => ({
  buildMmaClient: async () => ({ journalRecall }),
}));

const logAction = vi.fn(async (_input: Record<string, unknown>) => {});
vi.mock('@/observability/action-log', () => ({
  logAction: (input: Record<string, unknown>) => logAction(input),
}));

vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/workspace' }));

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
  journalRecall.mockClear();
  logAction.mockClear();
});

describe('POST /api/journal/recall', () => {
  it('unauthenticated → 401 BEFORE any dispatch (F16)', async () => {
    mockCaller = null;
    const res = await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    expect(res.status).toBe(401);
    expect(journalRecall).not.toHaveBeenCalled();
  });

  it('cross-origin → 403 BEFORE any dispatch (CSRF, F13)', async () => {
    mockCaller = asMember();
    const res = await POST(
      recallReq({ query: 'how do we gate completion?' }, { 'sec-fetch-site': 'cross-site' }) as never,
    );
    expect(res.status).toBe(403);
    expect(journalRecall).not.toHaveBeenCalled();
  });

  it('authenticated non-admin valid query → dispatch with cwd = workspace root → 202 batchId', async () => {
    mockCaller = asMember();
    const res = await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toEqual({ batchId: 'b-recall-1' });
    expect(journalRecall).toHaveBeenCalledTimes(1);
    expect(journalRecall.mock.calls[0]![0]).toBe('/workspace');
    expect(journalRecall.mock.calls[0]![1]).toEqual({ query: 'how do we gate completion?' });
  });

  it('logs a team-level action_log row (project_id null) on dispatch', async () => {
    mockCaller = asMember();
    await POST(recallReq({ query: 'how do we gate completion?' }) as never);
    expect(logAction).toHaveBeenCalledTimes(1);
    const arg = logAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.projectId).toBeNull();
    expect(arg.action).toBe('journal_recall');
    expect(arg.memberId).toBe('m-x');
  });

  it('trimmed query < 10 → 400, no dispatch (incl raw≥10 that trims below, F1)', async () => {
    mockCaller = asMember();
    const short = await POST(recallReq({ query: 'too short' }) as never);
    expect(short.status).toBe(400);
    const trimmed = await POST(recallReq({ query: '          short   ' }) as never); // raw≥10, trims to 'short'
    expect(trimmed.status).toBe(400);
    expect(journalRecall).not.toHaveBeenCalled();
  });

  it('trimmed query > 4000 → 400, no dispatch (F6)', async () => {
    mockCaller = asMember();
    const res = await POST(recallReq({ query: 'a'.repeat(4001) }) as never);
    expect(res.status).toBe(400);
    expect(journalRecall).not.toHaveBeenCalled();
  });
});
