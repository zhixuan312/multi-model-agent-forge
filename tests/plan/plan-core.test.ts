import { describe, it, expect } from 'vitest';

describe('plan-core', () => {
  describe('planTaskToView', () => {
    it('maps DB row to client-safe view type', async () => {
      const { planTaskToView } = await import('@/plan/plan-core');
      const row = {
        id: 'task-1',
        title: 'Task 1: Add the widget',
        detail: 'Full task detail markdown',
        targetRepoId: 'repo-1',
        dependsOn: null as string[] | null,
        orderIndex: 0,
        reviewPolicy: 'full',
        status: 'queued',
      };
      const view = planTaskToView(row, 'my-repo');
      expect(view.id).toBe('task-1');
      expect(view.title).toBe('Task 1: Add the widget');
      expect(view.body).toBe('Full task detail markdown');
      expect(view.targetRepo).toBe('my-repo');
      expect(view.num).toBe(1);
      expect(view.dependsOn).toEqual([]);
      expect(view.files).toEqual([]);
    });

    it('extracts task number from title prefix', async () => {
      const { planTaskToView } = await import('@/plan/plan-core');
      const view = planTaskToView({
        id: 'task-5',
        title: 'Task 5: Implement the handler',
        detail: '',
        targetRepoId: 'repo-1',
        dependsOn: null,
        orderIndex: 4,
        reviewPolicy: 'full',
        status: 'queued',
      }, 'repo');
      expect(view.num).toBe(5);
    });

    it('extracts files from detail markdown preamble', async () => {
      const { planTaskToView } = await import('@/plan/plan-core');
      const detail = `**Files:**
- Create: \`src/foo.ts\`
- Modify: \`src/bar.ts:10-20\`
- Test: \`tests/foo.test.ts\`

- [ ] **Step 1: Write the test**`;
      const view = planTaskToView({
        id: 't1', title: 'Task 1: Test', detail,
        targetRepoId: 'r', dependsOn: null, orderIndex: 0,
        reviewPolicy: 'full', status: 'queued',
      }, 'repo');
      expect(view.files).toEqual(['src/foo.ts', 'src/bar.ts:10-20', 'tests/foo.test.ts']);
    });

    it('maps dependsOn UUIDs to task title references', async () => {
      const { planTaskToView } = await import('@/plan/plan-core');
      const view = planTaskToView({
        id: 't2', title: 'Task 2: Handler', detail: '',
        targetRepoId: 'r', dependsOn: ['uuid-1', 'uuid-2'], orderIndex: 1,
        reviewPolicy: 'full', status: 'queued',
      }, 'repo', new Map([['uuid-1', 'Task 1'], ['uuid-2', 'Task 3']]));
      expect(view.dependsOn).toEqual(['Task 1', 'Task 3']);
    });
  });

  describe('groupTasksIntoPhases', () => {
    it('groups tasks into a single phase when no phase markers exist', async () => {
      const { groupTasksIntoPhases } = await import('@/plan/plan-core');
      const tasks = [
        { id: 't1', num: 1, title: 'Task 1', body: '', files: [], dependsOn: [], targetRepo: 'r' },
        { id: 't2', num: 2, title: 'Task 2', body: '', files: [], dependsOn: [], targetRepo: 'r' },
      ];
      const phases = groupTasksIntoPhases(tasks);
      expect(phases).toHaveLength(1);
      expect(phases[0].title).toBe('Implementation');
      expect(phases[0].tasks).toHaveLength(2);
    });

    it('returns empty array for empty tasks', async () => {
      const { groupTasksIntoPhases } = await import('@/plan/plan-core');
      expect(groupTasksIntoPhases([])).toEqual([]);
    });
  });
});
