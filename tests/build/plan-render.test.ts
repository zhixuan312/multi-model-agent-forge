// @vitest-environment node
import {
  validateAndResolve,
  renderRepoPlan,
  lintNoCommitSteps,
  PlanAuthorError,
} from '@/build/plan-render';
import type { PlanDraft } from '@/build/plan-schema';

const REPO_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const REPO_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function draft(tasks: PlanDraft['tasks']): PlanDraft {
  return { tasks };
}

describe('plan-render: validateAndResolve', () => {
  it('decomposes one target_repo_id per task', () => {
    const d = draft([
      { title: 'Task 1: A', detail: 'do A', targetRepoId: REPO_A, dependsOn: [], reviewPolicy: 'full' },
      { title: 'Task 2: B', detail: 'do B', targetRepoId: REPO_B, dependsOn: [], reviewPolicy: 'full' },
    ]);
    const resolved = validateAndResolve(d, new Set([REPO_A, REPO_B]));
    expect(resolved).toHaveLength(2);
    expect(resolved[0].targetRepoId).toBe(REPO_A);
    expect(resolved[1].targetRepoId).toBe(REPO_B);
  });

  it('wires a cross-repo unit as two tasks via depends_on', () => {
    const d = draft([
      { title: 'Lib change', detail: 'lib', targetRepoId: REPO_A, dependsOn: [], reviewPolicy: 'full' },
      { title: 'Consumer change', detail: 'consume', targetRepoId: REPO_B, dependsOn: ['Lib change'], reviewPolicy: 'full' },
    ]);
    const resolved = validateAndResolve(d, new Set([REPO_A, REPO_B]));
    expect(resolved[1].dependsOnTitles).toEqual(['Lib change']);
  });

  it('rejects an unknown targetRepoId', () => {
    const d = draft([{ title: 'X', detail: 'x', targetRepoId: 'nope', dependsOn: [], reviewPolicy: 'full' }]);
    expect(() => validateAndResolve(d, new Set([REPO_A])))
      .toThrowError(expect.objectContaining({ reason: 'unknown_repo' }));
  });

  it('rejects an empty task list', () => {
    expect(() => validateAndResolve(draft([]), new Set([REPO_A])))
      .toThrowError(expect.objectContaining({ reason: 'empty_tasks' }));
  });

  it('rejects a dependency cycle', () => {
    const d = draft([
      { title: 'A', detail: 'a', targetRepoId: REPO_A, dependsOn: ['B'], reviewPolicy: 'full' },
      { title: 'B', detail: 'b', targetRepoId: REPO_A, dependsOn: ['A'], reviewPolicy: 'full' },
    ]);
    expect(() => validateAndResolve(d, new Set([REPO_A])))
      .toThrowError(expect.objectContaining({ reason: 'dep_cycle' }));
  });

  it('rejects duplicate titles (ATX headings must be unique)', () => {
    const d = draft([
      { title: 'Same', detail: 'a', targetRepoId: REPO_A, dependsOn: [], reviewPolicy: 'full' },
      { title: 'Same', detail: 'b', targetRepoId: REPO_A, dependsOn: [], reviewPolicy: 'full' },
    ]);
    expect(() => validateAndResolve(d, new Set([REPO_A])))
      .toThrowError(expect.objectContaining({ reason: 'duplicate_title' }));
  });

  it('rejects any git-commit step (all three tokens)', () => {
    for (const tok of ['git commit -m x', 'git add .', 'git push origin']) {
      expect(() => lintNoCommitSteps({ title: 'T', detail: `then run ${tok}` }))
        .toThrowError(PlanAuthorError);
    }
  });
});

describe('plan-render: renderRepoPlan', () => {
  it('emits each title as a verbatim, unique ATX heading that round-trips', () => {
    const resolved = validateAndResolve(
      draft([
        { title: 'Task 1: Add cache', detail: 'cache it', targetRepoId: REPO_A, dependsOn: [], reviewPolicy: 'full' },
        { title: 'Task 2: Wire it', detail: 'wire it', targetRepoId: REPO_A, dependsOn: [], reviewPolicy: 'full' },
      ]),
      new Set([REPO_A]),
    );
    const md = renderRepoPlan(resolved);
    expect(md).toContain('## Task 1: Add cache');
    expect(md).toContain('## Task 2: Wire it');
    // The heading text (sans `## `) === project_plan_task.title byte-for-byte.
    const headings = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(headings).toEqual(['Task 1: Add cache', 'Task 2: Wire it']);
    // No git-commit tokens leaked into the rendered plan.
    expect(md).not.toMatch(/git (commit|add|push)/);
  });
});
