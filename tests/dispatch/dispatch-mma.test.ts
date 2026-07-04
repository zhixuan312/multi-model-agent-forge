// @vitest-environment node
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import type { MmaClient } from '@/mma/client';
import { createMockDb } from '../test-utils/mock-db';

/**
 * Regression: a SYNC (`await: true`) dispatch must persist the MMA task id into
 * `ops_mma_batch.batch_id`. Before the fix, the sync path stored status/result/
 * usage but never the MMA task id, so every automation dispatch row had a NULL
 * `batch_id` and could not be traced back to the MMA task in MMA's own logs.
 */
describe('dispatchMma — sync path persists the MMA task id', () => {
  function fakeMma(env: unknown, mmaTaskId: string): MmaClient {
    return {
      dispatchAndWait: async () => ({ batchId: mmaTaskId, envelope: env }),
    } as unknown as MmaClient;
  }

  const terminalEnvelope = {
    task: { type: 'orchestrate', status: 'done', taskId: 'mma-task-99' },
    output: { summary: 'done', filesChanged: [] },
    metrics: {},
    error: null,
  };

  it('sets batchId (MMA task id) on the ops_mma_batch row after a sync dispatch', async () => {
    const db = createMockDb({
      'insert:ops_mma_batch': [{ id: 'row-1', createdAt: new Date() }],
    });

    const res = await dispatchMma({
      db,
      mma: fakeMma(terminalEnvelope, 'mma-task-99'),
      projectId: 'proj-1',
      route: 'orchestrate',
      handler: 'test-noop-handler', // unregistered → handler fire is skipped
      cwd: '/w',
      body: { prompt: 'x' },
      actorId: '00000000-0000-0000-0000-000000000000',
      await: true,
    });

    expect(res.batchRowId).toBe('row-1');

    // Find the UPDATE ...set(...) call on ops_mma_batch and assert it carried batchId.
    const setCalls = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set');
    expect(setCalls.length).toBeGreaterThan(0);
    const setArg = setCalls[0].args[0] as Record<string, unknown>;
    expect(setArg.status).toBe('done');
    expect(setArg.batchId).toBe('mma-task-99');
  });
});
