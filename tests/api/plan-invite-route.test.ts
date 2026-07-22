// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

// The route delegates CSRF + auth + tenant scope to the shared `guardSpecWrite` (proven across
// ~10 routes); here we mock the guard to isolate the route's OWN logic: invitee-in-team check,
// plan-level participant persistence, and the single notification. `guardResult` is either the
// resolved actor or an error NextResponse (the unauth path).
let guardResult: { memberId: string; member: AuthedMember } | NextResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
let capturedMutator: ((d: { stages: { plan: { participants: string[] } } }) => unknown) | null = null;
const insertNotification = vi.fn(async () => 'n1');

vi.mock('@/spec/handler-guard', () => ({ guardSpecWrite: async () => guardResult }));
vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async (_db: unknown, _id: string, fn: (d: unknown) => unknown) => { capturedMutator = fn as never; }) }));
vi.mock('@/collab/notification-store', () => ({ insertNotification }));
vi.mock('@/details/schema', () => ({ validateDetails: (x: unknown) => x }));
vi.mock('@/db/client', async (orig) => ({
  ...(await (orig() as Promise<object>)),
  getDb: () => createMockDb({ 'select:team_member': [{ id: 'bob' }], 'select:project': [{ name: 'Proj', details: {} }] }),
}));

const { POST } = await import('../../app/api/projects/[id]/plan/tasks/[taskId]/invite/route');
const ctx = { params: Promise.resolve({ id: 'p1', taskId: 't1' }) };
const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const actor = (id: string): AuthedMember => ({ id, username: id, displayName: 'Me', avatarTint: '#000', role: 'member', teamId: 't1' });

describe('plan invite — plan-level participant persisted, single notification (QA F#2)', () => {
  beforeEach(() => { insertNotification.mockClear(); capturedMutator = null; });

  it('401 when the guard rejects (unauthenticated / cross-tenant)', async () => {
    guardResult = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    expect((await POST(req({ memberId: 'b' }) as never, ctx)).status).toBe(401);
    expect(insertNotification).not.toHaveBeenCalled();
  });

  it('400 when memberId is missing', async () => {
    guardResult = { memberId: 'me', member: actor('me') };
    expect((await POST(req({}) as never, ctx)).status).toBe(400);
    expect(insertNotification).not.toHaveBeenCalled();
  });

  it('persists the invitee (and inviter) to plan participants + exactly ONE notification', async () => {
    guardResult = { memberId: 'me', member: actor('me') };
    const res = await POST(req({ memberId: 'bob' }) as never, ctx);
    expect(res.status).toBe(200);
    const d = { stages: { plan: { participants: [] as string[] } } };
    capturedMutator!(d);
    expect(d.stages.plan.participants).toEqual(['me', 'bob']); // persisted → survives navigation
    expect(insertNotification).toHaveBeenCalledTimes(1); // NOT one-per-task
    expect(insertNotification).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'bob', sourceId: 'plan-invite:bob' }),
      expect.anything(),
    );
  });
});
