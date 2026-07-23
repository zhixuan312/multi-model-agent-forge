// @vitest-environment node
import { listAllRuns, latestRunPerLoop } from '@/loops/runs-query';
import { createMockDb } from '../test-utils/mock-db';

const run = (over: Record<string, unknown>) => ({
  id: 'x', loopId: 'l1', runId: 'f1', repoId: 'r1', trigger: 'manual', status: 'changed',
  branch: null, prUrl: null, mmaBatchId: null, keyChanges: null, verification: null,
  filesChanged: null, journalEntries: null, startedAt: new Date(), finishedAt: null, ...over,
});

// teamId is a REQUIRED arg on both queries (fail-closed team scoping). The mock DB
// ignores WHERE clauses, so these assert the call path/shape; the actual per-team
// SQL filter (eq(loopRun.teamId, teamId)) is proven against a live two-team database.
const TEAM = 'team-1';

describe('runs-query', () => {
  it('listAllRuns works with and without filters', async () => {
    const db = createMockDb({ 'select:loop_run': [run({ id: 'a' })] }) as never;
    expect((await listAllRuns({ db, teamId: TEAM })).map((r) => r.id)).toEqual(['a']);
    expect((await listAllRuns({ db, teamId: TEAM, loopId: 'l1', status: 'failed' })).map((r) => r.id)).toEqual(['a']);
  });

  it('includes in-progress (running) runs so they show in history', async () => {
    const db = createMockDb({ 'select:loop_run': [run({ id: 'live', status: 'running' })] }) as never;
    expect((await listAllRuns({ db, teamId: TEAM }))[0].status).toBe('running');
  });

  it('latestRunPerLoop keeps the first (newest) row seen per loop', async () => {
    const db = createMockDb({
      'select:loop_run': [
        run({ id: 'newL1', loopId: 'l1' }),
        run({ id: 'oldL1', loopId: 'l1' }),
        run({ id: 'newL2', loopId: 'l2' }),
      ],
    }) as never;
    const map = await latestRunPerLoop({ db, teamId: TEAM });
    expect(map.l1.id).toBe('newL1');
    expect(map.l2.id).toBe('newL2');
  });
});
