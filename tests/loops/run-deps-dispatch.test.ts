import { vi } from 'vitest';
import { buildLoopRunDeps } from '@/loops/run-deps';
import { createMockDb } from '../test-utils/mock-db';

// Mock the MMA client factory so the loop `dispatch` dep runs a fake terminal envelope
// instead of a real MMA call.
vi.mock('@/mma/server-client', () => ({
  buildMmaClient: async () => ({
    dispatchAndWait: async () => ({
      batchId: 'm-loop-1',
      envelope: { task: { type: 'delegate', status: 'done', taskId: 'm-loop-1' }, output: { summary: 'done' }, error: null },
    }),
  }),
}));

/**
 * R2 / AC5 — regression guard for the loop-work breakage. Loops dispatch handler-less
 * (inline-consume) via `dispatchMma`; before the inline-consume contract the sync
 * missing-handler throw failed EVERY loop dispatch. This test exercises a REAL
 * `dispatchMma` through the loop `dispatch` dep and asserts the batch ends `done`
 * (not `failed`) with no throw — the exact path that Stage 5 (work) rides.
 */
describe('loop dispatch — inline-consume, no missing-handler throw (R2/AC5)', () => {
  it('loop-work dispatch returns a summary and marks the batch done, never failed', async () => {
    const db = createMockDb({
      'insert:ops_mma_batch': [{ id: 'row-lw', createdAt: new Date() }],
    });
    const currentTeam = { id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base', gitTokenRef: null };
    const deps = await buildLoopRunDeps(currentTeam, { db });
    const out = await deps.dispatch({
      repo: { id: 'r1', pathOnDisk: '/x', name: 'x', defaultBranch: 'main' },
      cwd: '/w', prompt: 'do the thing', workerTier: 'complex',
      priorJournalContext: '', loopRunId: 'lr-1',
    } as Parameters<typeof deps.dispatch>[0]);

    expect(out).toHaveProperty('keyChanges');
    expect(out).toHaveProperty('mmaBatchId', 'row-lw');
    const setCalls = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set').map((c) => c.args[0] as Record<string, unknown>);
    expect(setCalls.some((a) => a.status === 'done')).toBe(true);
    expect(setCalls.some((a) => a.status === 'failed')).toBe(false); // the regression: used to fail "No terminal handler registered for 'loop-work'"
  });
});
