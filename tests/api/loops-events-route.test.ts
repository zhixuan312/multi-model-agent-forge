// @vitest-environment node
import { vi } from 'vitest';

let result: unknown = { kind: 'accepted', runId: 'run-1' };
vi.mock('@/loops/event-trigger', () => ({
  acceptLoopEvent: async () => result,
}));

const { POST, runtime } = await import('../../app/api/loops/[id]/events/route');

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/loops/loop-1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: 'loop-1' }) };

describe('loops events route', () => {
  it('pins the route to the nodejs runtime', () => {
    expect(runtime).toBe('nodejs');
  });

  it('maps accepted and duplicate deliveries to 202 with runId', async () => {
    result = { kind: 'accepted', runId: 'run-1' };
    const res = await POST(req({ goal: 'Investigate incident' }, { authorization: 'Bearer tok', 'idempotency-key': 'evt-1' }) as never, ctx as never);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: 'run-1' });
  });

  it('maps invalid_request, unauthorized, wrong_mode, not_found, and internal_error', async () => {
    result = { kind: 'invalid_request' };
    expect((await POST(req({ goal: '' }, { authorization: 'Bearer tok' }) as never, ctx as never)).status).toBe(400);

    result = { kind: 'unauthorized' };
    expect((await POST(req({ goal: 'x' }, { 'idempotency-key': 'evt-1' }) as never, ctx as never)).status).toBe(401);

    result = { kind: 'wrong_mode' };
    expect((await POST(req({ goal: 'x' }, { authorization: 'Bearer tok', 'idempotency-key': 'evt-1' }) as never, ctx as never)).status).toBe(403);

    result = { kind: 'not_found' };
    expect((await POST(req({ goal: 'x' }, { authorization: 'Bearer tok', 'idempotency-key': 'evt-1' }) as never, ctx as never)).status).toBe(404);

    result = { kind: 'internal_error' };
    expect((await POST(req({ goal: 'x' }, { authorization: 'Bearer tok', 'idempotency-key': 'evt-1' }) as never, ctx as never)).status).toBe(500);
  });
});
