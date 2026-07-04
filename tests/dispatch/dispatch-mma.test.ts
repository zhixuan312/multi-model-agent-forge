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

/**
 * Robustness: an MMA task that RAN but FAILED carries a non-null `error` object in
 * its terminal envelope (e.g. `reviewer_parse_failed` from a provider 401). The
 * sync path must mark the row `failed` and THROW — so the caller's retry/stop logic
 * engages. Before the fix it stored `done` and swallowed the handler throw, so an
 * audit that never recorded a pass made the resolver re-dispatch "pass 1" forever.
 */
describe('dispatchMma — error envelope is a failure, not a silent success', () => {
  function fakeMma(env: unknown): MmaClient {
    return { dispatchAndWait: async () => ({ batchId: 'mma-err-1', envelope: env }) } as unknown as MmaClient;
  }

  const erroredEnvelope = {
    task: { type: 'audit', status: 'error', taskId: 'mma-err-1' },
    output: { summary: 'Failed to authenticate. API Error: 401 Invalid authentication credentials' },
    metrics: {},
    error: { code: 'reviewer_parse_failed', message: 'No JSON found in reviewer output' },
  };

  it('marks the row failed and throws when the envelope carries an error', async () => {
    const db = createMockDb({ 'insert:ops_mma_batch': [{ id: 'row-e', createdAt: new Date() }] });

    await expect(dispatchMma({
      db, mma: fakeMma(erroredEnvelope), projectId: 'proj-1', route: 'audit',
      handler: 'plan-audit', cwd: '/w', body: { prompt: 'x' },
      actorId: '00000000-0000-0000-0000-000000000000', await: true,
    })).rejects.toThrow(/reviewer_parse_failed/);

    const setCalls = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set');
    const statuses = setCalls.map((c) => (c.args[0] as Record<string, unknown>).status);
    expect(statuses).toContain('failed');
    expect(statuses).not.toContain('done'); // never recorded as success
  });
});
