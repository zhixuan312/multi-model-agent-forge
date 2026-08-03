// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

/**
 * `POST /api/projects/[id]/batches/[batchId]/cancel`. Two independent gates, both
 * required: the caller must be able to READ the project (team-scoped), AND the batch must
 * belong to that project — otherwise a member of team A could stop team B's work by
 * guessing a batch id. Every negative case answers 404 (anti-enumeration), never 403.
 */

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const readable = vi.fn(async () => {});
vi.mock('@/projects/projects-core', async () => {
  const actual = await vi.importActual<typeof import('@/projects/projects-core')>('@/projects/projects-core');
  return { ...actual, assertProjectReadable: readable };
});

let batchRows: Array<Record<string, unknown>> = [];
vi.mock('@/db/client', () => ({
  getDb: () => createMockDb({ 'select:ops_mma_batch': () => batchRows }),
}));

const requestCancel = vi.fn(async () => ({ kind: 'requested' as const }));
vi.mock('@/sse/poll-manager', () => ({ getPollManager: () => ({ requestCancel }) }));

const { POST } = await import('../../app/api/projects/[id]/batches/[batchId]/cancel/route');
const { ProjectAccessError } = await import('@/projects/projects-core');

const MEMBER: AuthedMember = {
  id: 'm1', username: 'm1', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 'team-1',
};

function call(id = 'proj-1', batchId = 'row-1') {
  const req = new Request(`http://localhost/api/projects/${id}/batches/${batchId}/cancel`, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  return POST(req as never, { params: Promise.resolve({ id, batchId }) });
}

describe('POST /api/projects/[id]/batches/[batchId]/cancel', () => {
  beforeEach(() => {
    mockCaller = MEMBER;
    batchRows = [{ id: 'row-1', status: 'running' }];
    readable.mockClear();
    readable.mockImplementation(async () => {});
    requestCancel.mockClear();
    requestCancel.mockImplementation(async () => ({ kind: 'requested' as const }));
  });

  it('unauthenticated → 401, and never reaches MMA', async () => {
    mockCaller = null;
    expect((await call()).status).toBe(401);
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('authenticated but team-less → 401 (cannot form a project actor)', async () => {
    mockCaller = { ...MEMBER, teamId: null };
    expect((await call()).status).toBe(401);
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('cross-origin → rejected before auth', async () => {
    const req = new Request('http://localhost/api/projects/proj-1/batches/row-1/cancel', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'proj-1', batchId: 'row-1' }) });
    expect(res.status).toBe(403);
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('a project the caller cannot read → 404, and never reaches MMA', async () => {
    readable.mockImplementation(async () => { throw new ProjectAccessError('nope'); });
    expect((await call()).status).toBe(404);
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('a batch that is not this project’s → 404, and never reaches MMA', async () => {
    batchRows = []; // the (id, projectId) lookup found nothing
    expect((await call('proj-1', 'someone-elses-batch')).status).toBe(404);
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('happy path → 202 requested', async () => {
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ batchId: 'row-1', state: 'requested', cancellationRequested: true });
    expect(requestCancel).toHaveBeenCalledWith('row-1');
    // Two args, not three: the shared `guardProjectRead` calls this without threading a
    // `db` — same as `guardProjectWrite` — and both resolve the same connection.
    expect(readable).toHaveBeenCalledWith('proj-1', { id: 'm1', teamId: 'team-1' });
  });

  it('is idempotent — a repeat request is still 202, not an error', async () => {
    requestCancel.mockImplementation(async () => ({ kind: 'already_requested' } as never));
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ state: 'already_requested', cancellationRequested: true });
  });

  it('an already-terminal batch row → 200, without calling MMA', async () => {
    batchRows = [{ id: 'row-1', status: 'done' }];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ batchId: 'row-1', state: 'already_terminal', status: 'done' });
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('a race where the engine reports terminal first → 200 with the engine state', async () => {
    requestCancel.mockImplementation(async () => ({ kind: 'already_terminal', status: 'completed' } as never));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'already_terminal', status: 'completed' });
  });

  it('an in-flight row nothing is polling → 409 not_tracked (honest, not a fake success)', async () => {
    requestCancel.mockImplementation(async () => ({ kind: 'not_tracked' } as never));
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ batchId: 'row-1', state: 'not_tracked' });
  });
});
