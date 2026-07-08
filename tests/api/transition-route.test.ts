// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({ currentMember: async () => mockCaller }));
vi.mock('@/auth/same-origin', () => ({ rejectCrossOrigin: () => null }));
vi.mock('@/dispatch/handler-registry', () => ({}));
vi.mock('@/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/projects/projects-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/projects/projects-core')>();
  return { ...actual, assertProjectReadable: async () => {} };
});

const performTransition = vi.fn();
vi.mock('@/automation/perform-transition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/automation/perform-transition')>();
  return { ...actual, performTransition };
});

const { POST } = await import('../../app/api/projects/[id]/transition/route');
const { TransitionRejected } = await import('@/automation/perform-transition');

function req(body: unknown): Request {
  return new Request('http://localhost/api/projects/p1/transition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: 'p1' }) };
const member: AuthedMember = { id: 'm', username: 'x', displayName: 'X', avatarTint: '#000000', role: 'member', teamId: 'team-1' };

describe('POST /transition — error mapping', () => {
  beforeEach(() => { mockCaller = member; performTransition.mockReset(); });

  it('401 when unauthenticated', async () => {
    mockCaller = null;
    const res = await POST(req({ action: 'dispatch_audit' }) as never, ctx);
    expect(res.status).toBe(401);
  });

  it('400 on an invalid action kind', async () => {
    const res = await POST(req({ action: 'delete_everything' }) as never, ctx);
    expect(res.status).toBe(400);
    expect(performTransition).not.toHaveBeenCalled();
  });

  it('409 when performTransition refuses (TransitionRejected)', async () => {
    performTransition.mockRejectedValueOnce(new TransitionRejected('busy'));
    const res = await POST(req({ action: 'dispatch_audit' }) as never, ctx);
    expect(res.status).toBe(409);
  });

  it('200 on success, passing {kind,data} to the sole gate', async () => {
    performTransition.mockResolvedValueOnce(undefined);
    const res = await POST(req({ action: 'set_brief', data: { text: 'hi' } }) as never, ctx);
    expect(res.status).toBe(200);
    expect(performTransition).toHaveBeenCalledWith(
      expect.anything(), 'p1',
      { kind: 'set_brief', data: { text: 'hi' } },
      { mode: 'manual', actorId: 'm' },
    );
  });
});
