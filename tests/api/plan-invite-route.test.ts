// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';

let member: { id: string; displayName: string } | null = null;
let capturedMutator: ((d: { stages: { plan: { participants: string[] } } }) => unknown) | null = null;
const insertNotification = vi.fn(async () => 'n1');

vi.mock('@/auth/current-member', () => ({ currentMember: async () => member }));
vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async (_db: unknown, _id: string, fn: (d: unknown) => unknown) => { capturedMutator = fn as never; }) }));
vi.mock('@/collab/notification-store', () => ({ insertNotification }));
vi.mock('@/details/schema', () => ({ validateDetails: (x: unknown) => x }));
vi.mock('@/db/client', async (orig) => ({ ...(await (orig() as Promise<object>)), getDb: () => createMockDb({ 'select:project': [{ name: 'Proj', details: {} }] }) }));

const { POST } = await import('../../app/api/projects/[id]/plan/tasks/[taskId]/invite/route');
const ctx = { params: Promise.resolve({ id: 'p1', taskId: 't1' }) };
const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('plan invite — plan-level participant persisted, single notification (QA F#2)', () => {
  beforeEach(() => { insertNotification.mockClear(); capturedMutator = null; });

  it('401 when unauthenticated', async () => {
    member = null;
    expect((await POST(req({ memberId: 'b' }) as never, ctx)).status).toBe(401);
    expect(insertNotification).not.toHaveBeenCalled();
  });

  it('persists the invitee (and inviter) to plan participants + exactly ONE notification', async () => {
    member = { id: 'me', displayName: 'Me' };
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
