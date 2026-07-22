// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

let member: { id: string } | null = null;
vi.mock('@/auth/current-member', () => ({ currentMember: async () => member }));
const markRead = vi.fn(async () => {});
const dismiss = vi.fn(async () => {});
vi.mock('@/collab/notification-store', () => ({ markRead, dismiss }));

const { POST: readPOST } = await import('../../app/api/notifications/[id]/read/route');
const { POST: dismissPOST } = await import('../../app/api/notifications/[id]/dismiss/route');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('notification read/dismiss are authenticated + member-scoped (QA IDOR)', () => {
  beforeEach(() => { markRead.mockClear(); dismiss.mockClear(); });

  it('401 when unauthenticated — and nothing is marked/dismissed', async () => {
    member = null;
    expect((await readPOST(new Request('http://x'), ctx('n1'))).status).toBe(401);
    expect((await dismissPOST(new Request('http://x'), ctx('n1'))).status).toBe(401);
    expect(markRead).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('passes the CALLER member id to the store so it can only touch their own notifications', async () => {
    member = { id: 'me' };
    await readPOST(new Request('http://x'), ctx('n1'));
    expect(markRead).toHaveBeenCalledWith('n1', 'me');
    await dismissPOST(new Request('http://x'), ctx('n2'));
    expect(dismiss).toHaveBeenCalledWith('n2', 'me');
  });
});
