// @vitest-environment node
import { vi } from 'vitest';
import { startLoopRun, listLoopRuns } from '@/loops/run-now';
import type { LoopRunDeps } from '@/loops/run-engine';
import { createMockDb } from '../test-utils/mock-db';

const loopEventRow = {
  id: 'loop-1',
  teamId: 'team-1',
  name: 'Hygiene',
  kind: 'maintenance',
  config: { goalMd: 'g' },
  workerTier: 'complex',
  mode: 'event',
  cron: null,
  targetBranch: null,
  repoIds: ['r1', 'r2'],
  eventTokenHash: 'hash-1',
  enabled: true,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const teamRow = { id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/w', gitTokenRef: null };

describe('startLoopRun', () => {
  it('not_found when the loop is missing', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    expect((await startLoopRun('x', 'manual', { db })).kind).toBe('not_found');
  });

  it('threads goal override, idempotency, reference, and context into the runner context', async () => {
    const db = createMockDb({
      'select:loop_def': [loopEventRow],
      'select:team': [teamRow],
      'select:workspace_repo': [
        { id: 'r1', name: 'forge', pathOnDisk: '/w/forge' },
        { id: 'r2', name: 'engine', pathOnDisk: '/w/engine' },
      ],
      'insert:loop_run': [{ id: 'run-r1' }],
    });
    const runner = vi.fn(async () => []);
    const res = await startLoopRun('loop-1', 'event', {
      db,
      runId: 'fixed-run',
      goalOverride: 'Investigate incident INC-123',
      idempotencyKey: 'evt-123',
      reference: 'INC-123',
      context: 'Alarm source: pagerduty',
      background: false,
      runDeps: {} as LoopRunDeps,
      runner: runner as never,
    });
    expect(res).toEqual({ kind: 'started', runId: 'fixed-run' });
    const values = db._callsFor('loop_run').find((c) => c.method === 'values');
    expect(values?.args[0]).toMatchObject({
      trigger: 'event',
      idempotencyKey: 'evt-123',
      reference: 'INC-123',
    });
    expect(runner).toHaveBeenCalledWith(
      loopEventRow,
      [
        { id: 'r1', name: 'forge', pathOnDisk: '/w/forge' },
        { id: 'r2', name: 'engine', pathOnDisk: '/w/engine' },
      ],
      {
        runId: 'fixed-run',
        trigger: 'event',
        goalOverride: 'Investigate incident INC-123',
        idempotencyKey: 'evt-123',
        reference: 'INC-123',
        context: 'Alarm source: pagerduty',
        runRowByRepoId: expect.any(Map),
      },
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
