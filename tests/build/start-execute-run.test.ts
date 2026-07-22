// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

let capturedBody: Record<string, unknown> | null = null;
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: vi.fn(async ({ body }: { body: Record<string, unknown> }) => {
    capturedBody = body;
    return { batchRowId: 'b1' };
  }),
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
      'select:project': [{ name: 'Proj', details: buildInitialDetails() }],
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
