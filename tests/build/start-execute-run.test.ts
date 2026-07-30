// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

let capturedBody: Record<string, unknown> | null = null;
let capturedCwd: string | null = null;
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: vi.fn(async ({ body, cwd }: { body: Record<string, unknown>; cwd: string }) => {
    capturedBody = body;
    capturedCwd = cwd;
    return { batchRowId: 'b1' };
  }),
}));
vi.mock('@/projects/project-files', () => ({
  planFilePath: vi.fn(async () => '/abs/.mma/plans/plan.md'),
  readPlanFile: vi.fn(async () => ({ version: 1, updatedAt: '', bodyMd: '# Plan\n\n## Task 1' })),
}));
vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async () => {}) }));
// The worktree helper does real git + fs; its own behaviour is covered in
// tests/build/project-worktree.test.ts. Here we only care that execute is dispatched
// INTO whatever checkout it returns.
vi.mock('@/build/project-worktree', () => ({
  ensureProjectWorktree: vi.fn(async ({ projectId }: { projectId: string }) => `/repos/.forge-project-worktrees/${projectId}-demo`),
}));

import { startExecuteRun } from '@/build/start-execute-run';
import { ensureProjectWorktree } from '@/build/project-worktree';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

function db() {
  return createMockDb({
    // createdAt is load-bearing: the project branch is mma/<created-date>-<slug>.
    'select:project': [{ name: 'Proj', details: buildInitialDetails(), createdAt: new Date('2026-07-31T00:00:00Z') }],
    'select:workspace_repo': [{ name: 'demo', pathOnDisk: '/repos/demo' }],
  });
}

describe('startExecuteRun — plan path is a resolved string, not a Promise (execute 400 fix)', () => {
  beforeEach(() => { capturedBody = null; capturedCwd = null; });

  it('dispatches execute_plan with target.paths[0] as the awaited plan-file STRING', async () => {
    const res = await startExecuteRun(db(), {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]);
    expect(res.errors).toEqual([]);
    const paths = (capturedBody?.target as { paths: unknown[] }).paths;
    // The bug: planFilePath() was not awaited, so paths[0] was a Promise (serialises to {}),
    // which MMA rejects 400. It must be the resolved string.
    expect(typeof paths[0]).toBe('string');
    expect(paths[0]).toBe('/abs/.mma/plans/plan.md');
  });
});

describe('startExecuteRun — executes in the project\'s OWN worktree, not the shared clone', () => {
  beforeEach(() => { capturedBody = null; capturedCwd = null; vi.mocked(ensureProjectWorktree).mockClear(); });

  it('checks the project branch out via ensureProjectWorktree, off the repo + target branch', async () => {
    await startExecuteRun(db(), {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]);
    expect(ensureProjectWorktree).toHaveBeenCalledWith({
      repoPathOnDisk: '/repos/demo',
      projectId: 'p1',
      branch: 'mma/2026-07-31-proj',
      targetBranch: 'main',
    });
  });

  it('dispatches the engine INTO the worktree — the shared clone is never the cwd', async () => {
    // This is the whole point: several projects can target one repo, so pointing the
    // engine at the shared clone let one project's checkout swap the tree out from under
    // another project's running engine.
    await startExecuteRun(db(), {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]);
    expect(capturedCwd).toBe('/repos/.forge-project-worktrees/p1-demo');
    expect(capturedCwd).not.toBe('/repos/demo');
  });

  it('reports a worktree failure against that repo instead of dispatching', async () => {
    vi.mocked(ensureProjectWorktree).mockRejectedValueOnce(new Error('worktree add failed: locked'));
    const res = await startExecuteRun(db(), {} as never, 'p1', 'actor', [{ repoId: 'r1', targetBranch: 'main' }]);
    expect(res.dispatched).toEqual([]);
    expect(res.errors[0]).toMatchObject({ repoId: 'r1' });
    expect(res.errors[0].error).toContain('Worktree');
    expect(capturedCwd).toBeNull();
  });
});
