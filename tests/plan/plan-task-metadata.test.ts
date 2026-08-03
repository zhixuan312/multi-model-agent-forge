// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/projects/project-files', () => ({
  readPlanFile: vi.fn(async () => ({
    version: 1,
    updatedAt: '',
    bodyMd: '# Plan\n\n### Task 1: Add the widget\n\nDetail.\n\n### Task 2: Wire the handler\n\nDetail.\n',
  })),
  readSpecFile: vi.fn(async () => null),
}));
vi.mock('@/spec/audit-loop', () => ({ auditPassHistory: async () => [] }));

import { loadPlanView } from '@/plan/plan-core';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

/**
 * A plan task carries its own `targetRepoId`, `dependsOn` and `phase` in details.
 * `loadPlanView` discarded all three: it built its metadata rows with `dependsOn: null`,
 * `phase: null` and `targetRepoId` fixed to `repos[0]`.
 *
 * Both are rendered. Every task row shows `t.targetRepo` beside a branch icon — so on a
 * multi-repo project every task claimed to belong to the FIRST repo, whichever one it was
 * actually for — and `t.dependsOn.length > 0` gates a "· deps N" hint that could never
 * appear.
 */
describe('a plan task view carries its own metadata', () => {
  const detailsWithTasks = () => {
    const d = buildInitialDetails();
    d.repos = [
      { id: 'repo-a', name: 'engine', pathOnDisk: '/w/engine', defaultBranch: 'main' },
      { id: 'repo-b', name: 'forge', pathOnDisk: '/w/forge', defaultBranch: 'main' },
    ];
    d.stages.plan.phases.refine.tasks = [
      {
        id: 't1', title: 'Task 1: Add the widget', status: 'pending', approvals: [], attempts: [],
        reviewPolicy: 'reviewed', targetRepoId: 'repo-a', phase: 'Groundwork',
      },
      {
        id: 't2', title: 'Task 2: Wire the handler', status: 'pending', approvals: [], attempts: [],
        reviewPolicy: 'reviewed', targetRepoId: 'repo-b', dependsOn: ['t1'], phase: 'Groundwork',
      },
    ];
    return d;
  };

  const load = () =>
    loadPlanView(createMockDb({ 'select:project': [{ details: detailsWithTasks() }] }), 'p1');

  it('shows each task its OWN repository, not whichever repo happens to be first', async () => {
    const view = await load();
    const tasks = view.phases.flatMap((p) => p.tasks);
    expect(tasks.find((t) => t.title === 'Task 1: Add the widget')!.targetRepo).toBe('engine');
    expect(tasks.find((t) => t.title === 'Task 2: Wire the handler')!.targetRepo).toBe('forge');
  });

  it('carries the recorded dependencies', async () => {
    const view = await load();
    const tasks = view.phases.flatMap((p) => p.tasks);
    expect(tasks.find((t) => t.title === 'Task 2: Wire the handler')!.dependsOn).toEqual(['t1']);
    expect(tasks.find((t) => t.title === 'Task 1: Add the widget')!.dependsOn).toEqual([]);
  });
});
