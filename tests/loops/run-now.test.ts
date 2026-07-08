// @vitest-environment node
import { vi } from 'vitest';
import { startLoopRun, listLoopRuns } from '@/loops/run-now';
import type { LoopRunDeps } from '@/loops/run-engine';
import { createMockDb } from '../test-utils/mock-db';

const loopRow = { id: 'loop-1', teamId: 'team-1', name: 'Hygiene', kind: 'maintenance', config: { goalMd: 'g' }, workerTier: 'complex', cron: '0 3 * * *', repoIds: ['r1', 'r2'], enabled: true, createdBy: null, createdAt: new Date(), updatedAt: new Date() };
const teamRow = { id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/w', gitTokenRef: null };

describe('startLoopRun', () => {
  it('not_found when the loop is missing', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    expect((await startLoopRun('x', 'manual', { db })).kind).toBe('not_found');
  });

  it('loads the loop + its repos and fires the runner with a runId', async () => {
    const db = createMockDb({
      'select:loop_def': [loopRow],
      'select:team': [teamRow],
      'select:workspace_repo': [
        { id: 'r1', name: 'forge', pathOnDisk: '/w/forge' },
        { id: 'r2', name: 'engine', pathOnDisk: '/w/engine' },
      ],
      'insert:loop_run': [{ id: 'run-r1' }],
    });
    const runner = vi.fn(async () => []);
    const res = await startLoopRun('loop-1', 'manual', {
      db,
      runId: 'fixed-run',
      background: false,
      runDeps: {} as LoopRunDeps,
      runner: runner as never,
    });
    expect(res).toEqual({ kind: 'started', runId: 'fixed-run' });
    // Pre-created a running row per repo before firing (immediate UI/history reflection).
    expect(db._assertCalled('loop_run', 'insert')).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      loopRow,
      [
        { id: 'r1', name: 'forge', pathOnDisk: '/w/forge' },
        { id: 'r2', name: 'engine', pathOnDisk: '/w/engine' },
      ],
      { runId: 'fixed-run', trigger: 'manual', runRowByRepoId: expect.any(Map) },
      {},
    );
  });
});

describe('listLoopRuns', () => {
  it('returns the loop run rows', async () => {
    const db = createMockDb({ 'select:loop_run': [{ id: 'run-1' }, { id: 'run-2' }] });
    expect(await listLoopRuns('loop-1', { db })).toHaveLength(2);
  });
});
