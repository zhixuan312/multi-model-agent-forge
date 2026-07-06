// @vitest-environment node
import { vi } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';

// The recall poll route is now a pure READ of the ops_mma_batch row (the PollManager
// is the sole MMA poller). It authorizes by member and returns pending/terminal.

let memberId = 'm-owner';
vi.mock('@/journal/guard', () => ({
  guardJournal: async () => ({ memberId }),
}));

let rows: unknown[] = [];
vi.mock('@/db/client', () => ({
  getDb: () => createMockDb({ 'select:ops_mma_batch': rows }),
}));

const { GET } = await import('../../app/api/journal/recall/[batchId]/route');

function call(batchId: string) {
  return GET(new Request('http://localhost/api/journal/recall/x') as never, { params: Promise.resolve({ batchId }) });
}

beforeEach(() => { memberId = 'm-owner'; rows = []; });

describe('GET /api/journal/recall/[batchId] — pure row read + authz (AC14)', () => {
  it('404 when no row matches the member (non-owned or unknown batch)', async () => {
    rows = []; // the member-scoped query finds nothing
    const res = await call('ext-1');
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.state).toBe('not_found');
  });

  it('terminal envelope when the owned batch is done', async () => {
    rows = [{ status: 'done', result: { output: { summary: 'answer' }, error: null } }];
    const res = await call('ext-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state).toBe('terminal');
    expect(json.envelope).toEqual({ output: { summary: 'answer' }, error: null });
  });

  it('pending while the owned batch is still dispatched', async () => {
    rows = [{ status: 'dispatched', result: null }];
    const res = await call('ext-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state).toBe('pending');
  });
});
