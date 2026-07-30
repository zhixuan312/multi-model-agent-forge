// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

let capturedBody: Record<string, unknown> | null = null;
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: vi.fn(async ({ body }: { body: Record<string, unknown> }) => {
    capturedBody = body;
    return { batchRowId: 'b1' };
  }),
  // Declared INSIDE the factory: `vi.mock` is hoisted above the file's top-level
  // bindings, so referencing a class declared out here would be a TDZ error.
  PhaseBusyError: class extends Error {
    constructor(projectId: string, wantPhase: string, busyPhase: string) {
      super(`${projectId} wants ${wantPhase}, busy: ${busyPhase}`);
      this.name = 'PhaseBusyError';
    }
  },
}));
vi.mock('@/projects/project-files', () => ({
  planFilePath: vi.fn(async () => '/abs/.mma/plans/plan.md'),
  readPlanFile: vi.fn(async () => ({ version: 1, updatedAt: '', bodyMd: '# Plan\n\n## Task 1' })),
}));
vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async () => {}) }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'forge/x') }));

import { startExecuteRun } from '@/build/start-execute-run';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

describe('startExecuteRun — plan path is a resolved string, not a Promise (execute 400 fix)', () => {
  beforeEach(() => { capturedBody = null; });

  it('dispatches execute_plan with target.paths[0] as the awaited plan-file STRING', async () => {
    const db = createMockDb({
      // createdAt is load-bearing: the project branch is mma/<created-date>-<slug>.
      'select:project': [{ name: 'Proj', details: buildInitialDetails(), createdAt: new Date('2026-07-31T00:00:00Z') }],
      'select:workspace_repo': [{ name: 'demo', pathOnDisk: '/repos/demo' }],
    });
    const res = await startExecuteRun(db, {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]);
    expect(res.errors).toEqual([]);
    const paths = (capturedBody?.target as { paths: unknown[] }).paths;
    // The bug: planFilePath() was not awaited, so paths[0] was a Promise (serialises to {}),
    // which MMA rejects 400. It must be the resolved string.
    expect(typeof paths[0]).toBe('string');
    expect(paths[0]).toBe('/abs/.mma/plans/plan.md');
  });
});

describe('startExecuteRun — one project at a time per repo checkout', () => {
  beforeEach(() => { capturedBody = null; });

  const projectRow = [{ name: 'Proj', details: buildInitialDetails(), createdAt: new Date('2026-07-31T00:00:00Z') }];
  const repoRow = [{ name: 'demo', pathOnDisk: '/repos/demo' }];

  it('refuses to check out while ANOTHER project has a live batch in the same clone', async () => {
    const db = createMockDb({
      'select:project': projectRow,
      'select:workspace_repo': repoRow,
      // A dispatched/running batch on this cwd owned by a different project.
      'select:ops_mma_batch': [{ projectId: 'other-project' }],
    });
    // Must THROW (not collect an error) so the auto driver treats it as 'inflight' and
    // waits. The engine commits in this very clone now, so switching branches under a
    // live run would let its `git add -A` sweep our files into its commit.
    await expect(
      startExecuteRun(db, {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]),
    ).rejects.toMatchObject({ name: 'PhaseBusyError' });
    // Nothing was dispatched, and no git ran for this repo.
    expect(capturedBody).toBeNull();
  });

  it('proceeds when the only live batches in the clone belong to THIS project', async () => {
    const db = createMockDb({
      'select:project': projectRow,
      'select:workspace_repo': repoRow,
      // The `ne(projectId)` predicate filters our own rows out, so the guard sees none.
      'select:ops_mma_batch': [],
    });
    const res = await startExecuteRun(db, {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]);
    expect(res.errors).toEqual([]);
    expect(res.dispatched).toHaveLength(1);
    expect(res.dispatched[0].forgeBranch).toBe('mma/2026-07-31-proj');
  });
});
