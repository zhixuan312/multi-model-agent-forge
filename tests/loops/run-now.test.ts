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

  it('wrong_mode when a manual/scheduled trigger targets an event-mode loop (no run started)', async () => {
    const runner = vi.fn(async () => []);
    for (const trigger of ['manual', 'schedule'] as const) {
      const db = createMockDb({ 'select:loop_def': [loopEventRow] });
      const res = await startLoopRun('loop-1', trigger, { db, runner: runner as never, background: false });
      expect(res.kind).toBe('wrong_mode');
    }
    // The event-mode loop is fired only through the authenticated event endpoint, so the
    // manual/scheduled paths must never reach run creation.
    expect(runner).not.toHaveBeenCalled();
  });

  it('wrong_mode when an event trigger targets a non-event loop', async () => {
    const manualLoop = { ...loopEventRow, mode: 'manual', eventTokenHash: null };
    const db = createMockDb({ 'select:loop_def': [manualLoop] });
    const res = await startLoopRun('loop-1', 'event', { db, background: false });
    expect(res.kind).toBe('wrong_mode');
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

  // Tenant scope: the route passes the caller's teamId so a team_admin cannot read another team's
  // run history by id. (The mock cannot evaluate the WHERE; the teamId predicate is tsc-verified —
  // this locks that the scoped call path stays wired and non-throwing.)
  it('accepts a teamId scope', async () => {
    const db = createMockDb({ 'select:loop_run': [{ id: 'run-1' }] });
    expect(await listLoopRuns('loop-1', { db, teamId: 'team-1' })).toHaveLength(1);
  });
});

describe('startLoopRun — team scope', () => {
  // getLoop is scoped by teamId; a loop outside the caller's team resolves to not_found before any
  // run rows are created (the cross-tenant "Run now" fix).
  it('not_found when the loop is outside the caller team scope', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    const runner = vi.fn(async () => []);
    const res = await startLoopRun('loop-1', 'manual', { db, teamId: 'other-team', runner: runner as never, background: false });
    expect(res.kind).toBe('not_found');
    expect(runner).not.toHaveBeenCalled();
  });
});
