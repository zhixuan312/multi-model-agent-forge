// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const { dispatchMma } = vi.hoisted(() => ({
  dispatchMma: vi.fn(async (_opts: unknown) => ({ batchRowId: 'b1' })),
}));
vi.mock('@/dispatch/dispatch-helpers', () => ({ dispatchMma, findInflight: async () => null }));
vi.mock('@/build/project-worktree', () => ({ ensureProjectWorktree: async () => '/wt' }));
vi.mock('@/details/write', () => ({ updateDetails: async () => {} }));
vi.mock('@/projects/project-files', () => ({
  readPlanFile: async () => ({ version: 1, updatedAt: '', bodyMd: '# Plan' }),
  planFilePath: async () => '/w/plan.md',
}));

import { startExecuteRun } from '@/build/start-execute-run';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

/**
 * `execute_plan`'s `tasks[]` is a heading selector: empty means RUN THE WHOLE PLAN.
 *
 * That is right for a single-repo project — every task is for that repo — but on a
 * multi-repo project each repo gets its own dispatch in its own worktree, so an empty
 * selector told MMA to execute the OTHER repos' tasks there too, creating their files in
 * the wrong checkout. The per-repo titles were already computed and then sent only as
 * dead metadata (the terminal handler recomputes the list from details and never reads
 * them).
 */
function detailsWith(repoIds: string[]) {
  const d = buildInitialDetails();
  d.repos = repoIds.map((id) => ({ id, name: id, pathOnDisk: `/w/${id}`, defaultBranch: 'main' }));
  d.stages.plan.phases.refine.tasks = [
    { id: 't1', title: 'Task 1: A', status: 'approved', approvals: ['m'], attempts: [], reviewPolicy: 'reviewed', targetRepoId: repoIds[0] },
    { id: 't2', title: 'Task 2: B', status: 'approved', approvals: ['m'], attempts: [], reviewPolicy: 'reviewed', targetRepoId: repoIds[repoIds.length - 1] },
  ];
  return d;
}

const runWith = async (repoIds: string[]) => {
  dispatchMma.mockClear();
  const db = createMockDb({
    'select:project': [{ name: 'P', details: detailsWith(repoIds), createdAt: new Date('2026-01-01') }],
    'select:workspace_repo': [{ name: 'r', pathOnDisk: '/w/r' }],
  });
  await startExecuteRun(db, {} as never, 'p1', 'actor-1');
  return dispatchMma.mock.calls.map((c) => (c[0] as { body: { tasks: string[] } }).body.tasks);
};

describe('execute dispatch sends an empty task selector', () => {
  /**
   * Empty means "run the whole plan", and it is the only honest value today — including
   * for multi-repo projects. Scoping to one repo's tasks needs tasks to CARRY a repo, and
   * nothing populates `planTask.targetRepoId`: plan-author creates every task without it,
   * and the engine's plan format has no per-task repo field (a plan is scoped to one
   * repository by construction, while Forge authors one plan for N linked repos).
   *
   * So a filter over that field matches everything, and sending the full title list would
   * swap "run the whole plan" for "run these N headings" — no scoping gained, and a
   * heading the engine's matcher doesn't recognise would silently drop work.
   */
  it('sends [] for a single-repo project', async () => {
    const sent = await runWith(['repo-a']);
    expect(sent).toEqual([[]]);
  });

  it('sends [] for a multi-repo project too, since no task carries a repo', async () => {
    const sent = await runWith(['repo-a', 'repo-b']);
    expect(sent).toEqual([[], []]);
  });
});
