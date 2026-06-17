// @vitest-environment node
import { createMockDb, seq } from '../test-utils/mock-db';
import { authorPlan, getLatestPlanArtifact } from '@/build/plan-author';
import { AnthropicClient } from '@/anthropic/client';
import { planFilePath } from '@/build/plan-fs';
import { RecordingBus, FakePlanFs } from './fixtures';
import type { PlanDraft } from '@/build/plan-schema';

const anthropicStub = {} as unknown as AnthropicClient; // never called (draftOverride bypasses it)

function draft(tasks: PlanDraft['tasks']): PlanDraft {
  return { tasks };
}

describe('authorPlan', () => {
  it('decomposes one repo per task, writes a plan file per write-target repo, persists rows + artifact', async () => {
    const db = createMockDb({
      'select:project_repo': [
        { id: 'repo-a', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() },
        { id: 'repo-b', projectId: 'proj-1', name: 'repo-b', pathOnDisk: '/work/b', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() },
      ],
      'select:project_artifact': seq(
        [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
        [{ m: 0 }],
      ),
      'insert:project_plan_task': [
        { id: 'task-1', projectId: 'proj-1', targetRepoId: 'repo-a', title: 'Task 1: Cache', detail: 'add caching to A', orderIndex: 0, isWrite: true, status: 'queued', reviewPolicy: 'full', dependsOn: [], commitSha: null, fixNote: null, meta: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 'task-2', projectId: 'proj-1', targetRepoId: 'repo-b', title: 'Task 2: Read-only? no, write B', detail: 'wire B', orderIndex: 1, isWrite: true, status: 'queued', reviewPolicy: 'full', dependsOn: ['task-1'], commitSha: null, fixNote: null, meta: null, createdAt: new Date(), updatedAt: new Date() },
      ],
      'insert:project_artifact': [{ id: 'art-1', projectId: 'proj-1', kind: 'plan', bodyMd: '# Plan', version: 1, createdAt: new Date(), updatedAt: new Date() }],
    });
    const fs = new FakePlanFs();
    const bus = new RecordingBus();

    const res = await authorPlan(
      {
        db,
        anthropic: anthropicStub,
        fs,
        bus,
        draftOverride: draft([
          { title: 'Task 1: Cache', detail: 'add caching to A', targetRepoId: 'repo-a', dependsOn: [], reviewPolicy: 'full' },
          { title: 'Task 2: Read-only? no, write B', detail: 'wire B', targetRepoId: 'repo-b', dependsOn: ['Task 1: Cache'], reviewPolicy: 'full' },
        ]),
      },
      { projectId: 'proj-1', actorId: 'member-1' },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.writeTargets.sort()).toEqual(['repo-a', 'repo-b'].sort());
    expect(res.taskCount).toBe(2);

    // Plan file per write-target repo, under <repo>/.forge/, with verbatim ATX headings.
    const aFile = fs.files.get(planFilePath('/work/a', 'proj-1'));
    expect(aFile).toContain('## Task 1: Cache');
    expect(aFile).not.toMatch(/git (commit|add|push)/);

    // project_plan_task rows persisted (queued)
    expect(db._assertCalled('project_plan_task', 'insert')).toBe(true);

    // Combined plan artifact persisted.
    expect(db._assertCalled('project_artifact', 'insert')).toBe(true);

    // plan.authored emitted.
    expect(bus.ofType('plan.authored')).toHaveLength(1);
  });

  it('write/read split: a repo with no task is read-only', async () => {
    const db = createMockDb({
      'select:project_repo': [
        { id: 'repo-a', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() },
        { id: 'repo-metrics', projectId: 'proj-1', name: 'metrics', pathOnDisk: '/work/metrics', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() },
      ],
      'select:project_artifact': seq(
        [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
        [{ m: 0 }],
      ),
      'insert:project_plan_task': [{ id: 'task-1', projectId: 'proj-1', targetRepoId: 'repo-a', title: 'Only A', detail: 'do', orderIndex: 0, isWrite: true, status: 'queued', reviewPolicy: 'full', dependsOn: [], commitSha: null, fixNote: null, meta: null, createdAt: new Date(), updatedAt: new Date() }],
      'insert:project_artifact': [{ id: 'art-1', projectId: 'proj-1', kind: 'plan', bodyMd: '# Plan', version: 1, createdAt: new Date(), updatedAt: new Date() }],
    });
    const res = await authorPlan(
      { db, anthropic: anthropicStub, fs: new FakePlanFs(), bus: new RecordingBus(), draftOverride: draft([{ title: 'Only A', detail: 'do', targetRepoId: 'repo-a', dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId: 'proj-1', actorId: 'member-1' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.writeTargets).toEqual(['repo-a']);
    expect(res.readOnly).toEqual(['metrics']);
  });

  it('re-authoring increments the artifact version', async () => {
    const db = createMockDb({
      'select:project_repo': [{ id: 'repo-a', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'select:project_artifact': seq(
        [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
        [{ m: 0 }],
        [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
        [{ m: 1 }],
      ),
      'insert:project_plan_task': [{ id: 'task-1', projectId: 'proj-1', targetRepoId: 'repo-a', title: 'A', detail: 'd', orderIndex: 0, isWrite: true, status: 'queued', reviewPolicy: 'full', dependsOn: [], commitSha: null, fixNote: null, meta: null, createdAt: new Date(), updatedAt: new Date() }],
      'insert:project_artifact': [{ id: 'art-2', projectId: 'proj-1', kind: 'plan', bodyMd: '# Plan v2', version: 2, createdAt: new Date(), updatedAt: new Date() }],
    });
    const mk = () =>
      authorPlan(
        { db, anthropic: anthropicStub, fs: new FakePlanFs(), bus: new RecordingBus(), draftOverride: draft([{ title: 'A', detail: 'd', targetRepoId: 'repo-a', dependsOn: [], reviewPolicy: 'full' }]) },
        { projectId: 'proj-1', actorId: 'member-1' },
      );
    await mk();
    const second = await mk();
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.version).toBe(2);
  });

  it('unknown targetRepoId → plan.failed, no partial rows', async () => {
    const db = createMockDb({
      'select:project_repo': [{ id: 'repo-a', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'select:project_artifact': [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
    });
    const bus = new RecordingBus();
    const res = await authorPlan(
      { db, anthropic: anthropicStub, fs: new FakePlanFs(), bus, draftOverride: draft([{ title: 'X', detail: 'd', targetRepoId: 'unknown-repo', dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId: 'proj-1', actorId: 'member-1' },
    );
    expect(res.ok).toBe(false);
    expect(bus.ofType('plan.failed')).toHaveLength(1);
    expect(db._assertCalled('project_plan_task', 'insert')).toBe(false);
  });

  it('git-commit step in a task body → plan.failed, no rows', async () => {
    const db = createMockDb({
      'select:project_repo': [{ id: 'repo-a', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'select:project_artifact': [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
    });
    const res = await authorPlan(
      { db, anthropic: anthropicStub, fs: new FakePlanFs(), bus: new RecordingBus(), draftOverride: draft([{ title: 'X', detail: 'then git commit -m done', targetRepoId: 'repo-a', dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId: 'proj-1', actorId: 'member-1' },
    );
    expect(res.ok).toBe(false);
    expect(db._assertCalled('project_plan_task', 'insert')).toBe(false);
  });

  it('plan-file write failure halts before any dispatch, no rows persisted', async () => {
    const db = createMockDb({
      'select:project_repo': [{ id: 'repo-a', projectId: 'proj-1', name: 'repo-a', pathOnDisk: '/work/a', defaultBranch: 'main', createdAt: new Date(), updatedAt: new Date() }],
      'select:project_artifact': [{ id: 'spec-1', projectId: 'proj-1', kind: 'spec', bodyMd: '# Spec', version: 1, createdAt: new Date(), updatedAt: new Date() }],
    });
    const fs = new FakePlanFs();
    fs.failWriteOn = '.forge';
    const res = await authorPlan(
      { db, anthropic: anthropicStub, fs, bus: new RecordingBus(), draftOverride: draft([{ title: 'A', detail: 'd', targetRepoId: 'repo-a', dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId: 'proj-1', actorId: 'member-1' },
    );
    expect(res.ok).toBe(false);
    expect(db._assertCalled('project_plan_task', 'insert')).toBe(false);
    expect(db._assertCalled('project_artifact', 'insert')).toBe(false);
  });
});
