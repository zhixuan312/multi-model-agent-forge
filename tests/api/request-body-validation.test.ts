// @vitest-environment node
/**
 * Three routes pulled a field off `req.json()` through a cast — `as { action?: string }`,
 * `as { message?: string }`, `json?.memberId as string`. A cast is a claim, not a check,
 * and the wire is untrusted. The consequences differed in severity:
 *
 *   - `spec/approve` treated EVERYTHING that was not exactly `'revoke'` as approve, so a
 *     typo, an empty body, or a non-string all recorded an approval on the spec finalize
 *     GATE — the failure mode is silent and it is the wrong direction;
 *   - `plan/refine` called `.trim()` on whatever arrived, answering 500 for a bad body;
 *   - `teams/assign-admin` passed a non-string into a uuid comparison, which Postgres
 *     answers with an error — another 500.
 *
 * The same lesson `details-actions.ts` already carries in its own comments ("Validate
 * rather than cast").
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

const actor = (id: string): AuthedMember => ({
  id, username: id, displayName: 'Me', avatarTint: '#000', role: 'member', teamId: 't1',
});

let guardResult: { memberId: string; member: AuthedMember } | NextResponse =
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

const updateDetails = vi.fn(async (_db: unknown, _id: string, fn: (d: unknown) => unknown) => {
  fn({ stages: { spec: { phases: { finalize: { approvals: [] } } } } });
});
const recordActivity = vi.fn(async () => {});

vi.mock('@/auth/guard-project-write', () => ({
  guardProjectWrite: async () => guardResult,
  guardProjectRead: async () => guardResult,
}));
vi.mock('@/details/write', () => ({ updateDetails }));
vi.mock('@/activity/project-activity', () => ({ recordActivity }));
vi.mock('@/sse/event-bus', () => ({ projectEventBus: { publish: vi.fn() } }));
vi.mock('@/db/client', async (orig) => ({
  ...(await (orig() as Promise<object>)),
  getDb: () => createMockDb({}),
}));

const approve = await import('../../app/api/projects/[id]/spec/approve/route');

const req = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never;
const ctx = { params: Promise.resolve({ id: 'p1' }) };

beforeEach(() => {
  updateDetails.mockClear();
  recordActivity.mockClear();
  guardResult = { memberId: 'me', member: actor('me') };
});

describe('POST /spec/approve — the action is checked, not assumed', () => {
  it('approves on an absent action (the documented default)', async () => {
    const res = await approve.POST(req({}), ctx);
    expect(res.status).toBe(200);
    expect(recordActivity).toHaveBeenCalled();
  });

  it('revokes on the exact word', async () => {
    const res = await approve.POST(req({ action: 'revoke' }), ctx);
    expect(res.status).toBe(200);
    expect(updateDetails).toHaveBeenCalled();
    // A revoke is not an approval — it records no "approved the spec" activity.
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised action instead of approving', async () => {
    // `revokee` is the case that matters: one keystroke from the opposite outcome.
    for (const action of ['revokee', 'REVOKE', 'deny', '']) {
      updateDetails.mockClear();
      recordActivity.mockClear();
      const res = await approve.POST(req({ action }), ctx);
      expect(res.status, `action=${JSON.stringify(action)} must not be accepted`).toBe(400);
      expect(updateDetails, `action=${JSON.stringify(action)} must not mutate`).not.toHaveBeenCalled();
      expect(recordActivity).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-string action instead of approving', async () => {
    for (const action of [1, true, null, { revoke: true }, ['revoke']]) {
      updateDetails.mockClear();
      recordActivity.mockClear();
      const res = await approve.POST(req({ action }), ctx);
      expect(res.status, `action=${JSON.stringify(action)} must not be accepted`).toBe(400);
      expect(updateDetails).not.toHaveBeenCalled();
    }
  });

  it('still refuses before the guard passes', async () => {
    guardResult = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    expect((await approve.POST(req({}), ctx)).status).toBe(401);
    expect(updateDetails).not.toHaveBeenCalled();
  });
});
