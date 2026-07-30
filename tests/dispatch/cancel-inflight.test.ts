// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

const requestCancel = vi.fn(async (_id: string) => ({ kind: 'requested' as const }));
vi.mock('@/sse/poll-manager', () => ({ getPollManager: () => ({ requestCancel }) }));

import { cancelInFlightBatches } from '@/dispatch/cancel-inflight';
import { createMockDb } from '../test-utils/mock-db';

describe('cancelInFlightBatches — stopping automation must also stop the engine', () => {
  beforeEach(() => requestCancel.mockClear());

  it('requests a cancel for every in-flight batch of the project', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [{ id: 'b1' }, { id: 'b2' }] });
    expect(await cancelInFlightBatches(db, 'p1')).toBe(2);
    expect(requestCancel.mock.calls.map((c) => c[0])).toEqual(['b1', 'b2']);
  });

  it('is a no-op when nothing is running', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [] });
    expect(await cancelInFlightBatches(db, 'p1')).toBe(0);
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('counts an already-requested cancel as requested (idempotent re-stop)', async () => {
    requestCancel.mockResolvedValueOnce({ kind: 'already_requested' } as never);
    const db = createMockDb({ 'select:ops_mma_batch': [{ id: 'b1' }] });
    expect(await cancelInFlightBatches(db, 'p1')).toBe(1);
  });

  it('does not count a batch the poll manager no longer tracks', async () => {
    // A sync (`await:true`) dispatch, or one the engine has already forgotten: there is
    // nothing to cancel, and that is not a failure for the caller.
    requestCancel.mockResolvedValueOnce({ kind: 'not_tracked' } as never);
    const db = createMockDb({ 'select:ops_mma_batch': [{ id: 'b1' }] });
    expect(await cancelInFlightBatches(db, 'p1')).toBe(0);
  });

  it('keeps going when one cancel throws — one stuck batch must not strand the rest', async () => {
    requestCancel.mockRejectedValueOnce(new Error('engine unreachable'));
    const db = createMockDb({ 'select:ops_mma_batch': [{ id: 'b1' }, { id: 'b2' }] });
    await expect(cancelInFlightBatches(db, 'p1')).resolves.toBe(1);
    expect(requestCancel).toHaveBeenCalledTimes(2);
  });
});
