// @vitest-environment node

import {
  saveBrief,
  readRailTasks,
  latestExplorationArtifact,
  addTask,
  editTask,
  removeTask,
  TaskLockedError,
  TaskNotFoundError,
} from '@/exploration/explore-core';
import { createMockDb, seq } from '../test-utils/mock-db';
import { buildInitialDetails } from '@/details/schema';

describe('brief persistence', () => {
  it('saves and reads the brief via details', async () => {
    const projectId = 'proj-1';
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': seq(
        [{ details: d, detailsVersion: 0 }],
        [{ id: projectId }],
        [{ details: { ...d, stages: { ...d.stages, exploration: { ...d.stages.exploration, phases: { ...d.stages.exploration.phases, brief: { status: 'done', text: 'first dump' } } } } } }],
      ),
      'update:project': [{ id: projectId }],
    });

    await saveBrief(projectId, 'first dump', mockDb);
    expect(mockDb._wasCalled('project', 'update')).toBe(true);
  });
});

describe('rail + summary reads', () => {
  it('reads tasks from details + joins ops_mma_batch for results', async () => {
    const projectId = 'proj-2';
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [{
      kind: 'investigate', prompt: 'p', status: 'recorded',
      attempts: [{ batchId: 'batch-1', status: 'done', at: '' }],
    }];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:ops_mma_batch': [
        {
          id: 'batch-1',
          projectId,
          route: 'investigate',
          targetRepoId: null,
          cwd: '/work',
          batchId: 'mma',
          status: 'failed',
          request: {},
          result: { headline: 'oops', error: { code: 'e', message: 'boom' } },
          terminalAt: new Date(),
        },
      ],
    });

    const rail = await readRailTasks(projectId, mockDb);
    // This asserted `error: null` against a fixture that supplies
    // `error: { code: 'e', message: 'boom' }` — it pinned the drop as correct. The
    // rail's failed-task pane renders `error?.message ?? 'Unknown error.'`, so every
    // failure read "Unknown error." no matter what the engine said.
    expect(rail[0]).toMatchObject({
      batchStatus: 'failed',
      headline: 'oops',
      error: { code: 'e', message: 'boom' },
    });
  });

  it('a successful batch carries no error (not_applicable is the success sentinel)', async () => {
    const projectId = 'proj-2b';
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [{
      kind: 'investigate', prompt: 'p', status: 'recorded',
      attempts: [{ batchId: 'batch-ok', status: 'done', at: '' }],
    }];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:ops_mma_batch': [{
        id: 'batch-ok',
        status: 'done',
        // MMA sends this on SUCCESS. Reading `env.error` directly would have turned
        // every completed task into a failure.
        result: { error: { kind: 'not_applicable' }, output: { summary: 'all good' } },
      }],
    });

    const rail = await readRailTasks(projectId, mockDb);
    expect(rail[0]!.error).toBeNull();
    expect(rail[0]!.outputMd).toBe('all good');
  });

  it('latestExplorationArtifact reads from file', async () => {
    const projectId = 'proj-3';
    const { writeExplorationSummary } = await import('@/projects/project-files');
    await writeExplorationSummary(projectId, '## Background\n\nTest content');
    const a = await latestExplorationArtifact(projectId);
    expect(a).not.toBeNull();
    expect(a!.bodyMd).toContain('Test content');
  });
});

describe('task editing via details', () => {
  it('adds a manual research draft task via updateDetails', async () => {
    const projectId = 'proj-4';
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: projectId }],
    });

    const { id } = await addTask(projectId, { kind: 'research', prompt: 'what external options exist for this?' }, mockDb);
    // A real id, not a position. Positions shift the moment another task is removed, and
    // that shift is invisible to a second viewer — see the schema comment on `id`.
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockDb._wasCalled('project', 'update')).toBe(true);
  });

  it('a too-short prompt is reported as a too-short prompt', async () => {
    const d = buildInitialDetails();
    const mockDb = createMockDb({ 'select:project': [{ details: d, detailsVersion: 0 }] });
    // This threw TaskLockedError — so the route, which surfaces `err.message`
    // verbatim, told the user "Only draft tasks can be edited."
    await expect(
      addTask('proj-5', { kind: 'research', prompt: 'too short' }, mockDb),
    ).rejects.toThrow(/research prompt needs at least 20/);
    expect(mockDb._wasCalled('project', 'update')).toBe(false);
  });

  it('editing a task that is no longer a draft fails instead of quietly succeeding', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [{
      kind: 'journal', prompt: 'prior decisions', status: 'running', attempts: [],
    }];
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: 'proj-6' }],
    });
    // Addressed by the legacy positional id, which is what a task written before the id
    // field answers to until its project's first write.
    await expect(editTask('proj-6', 'task-0', { prompt: 'a different question entirely' }, mockDb))
      .rejects.toBeInstanceOf(TaskLockedError);
  });

  it('removing a task id that does not exist fails instead of quietly succeeding', async () => {
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: 'proj-7' }],
    });
    await expect(removeTask('proj-7', 'task-4', mockDb)).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(mockDb._wasCalled('project', 'update')).toBe(false);
  });
});

/**
 * Discover tasks were addressed by ARRAY INDEX: the rail rendered `task-<i>` and the routes
 * took that integer straight into `tasks[i]`. `removeTask` splices, so every index after the
 * removed one shifts — and these routes publish no SSE event, so a second person's rail keeps
 * the stale indices until they happen to reload. Their next edit rewrote a different task's
 * prompt, and nothing anywhere could tell.
 */
describe('a task is addressed by identity, not by position', () => {
  const withTasks = () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [
      { id: 'id-a', kind: 'journal', prompt: 'first task prompt', status: 'draft', attempts: [] },
      { id: 'id-b', kind: 'journal', prompt: 'second task prompt', status: 'draft', attempts: [] },
      { id: 'id-c', kind: 'journal', prompt: 'third task prompt', status: 'draft', attempts: [] },
    ];
    return d;
  };
  /**
   * A STATEFUL stub, because these cases are sequences: remove, then edit what is left.
   * `createMockDb` hands back the same canned row each select and drops what `set()` wrote,
   * so a second call would read the pre-remove document and every assertion would describe
   * a state the code never saw.
   */
  function statefulDb(initial: ReturnType<typeof buildInitialDetails>) {
    const state = { details: initial as unknown, version: 0 };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ details: state.details, detailsVersion: state.version }],
          }),
        }),
      }),
      update: () => ({
        set: (patch: { details?: unknown }) => ({
          where: () => ({
            returning: async () => {
              if (patch.details !== undefined) {
                state.details = patch.details;
                state.version += 1;
              }
              return [{ id: 'p1' }];
            },
          }),
        }),
      }),
      current: () => state.details as ReturnType<typeof buildInitialDetails>,
    };
    return db;
  }

  it('edits the task it names, after an earlier one was removed', async () => {
    const db = statefulDb(withTasks());
    await removeTask('p1', 'id-a', db as never);
    // `id-c` is now at index 1. The positional world would have edited `id-b` here.
    await editTask('p1', 'id-c', { prompt: 'the edited third prompt' }, db as never);

    const tasks = db.current().stages.exploration.phases.discover.tasks;
    expect(tasks.map((t) => t.id)).toEqual(['id-b', 'id-c']);
    expect(tasks.find((t) => t.id === 'id-c')!.prompt).toBe('the edited third prompt');
    expect(tasks.find((t) => t.id === 'id-b')!.prompt).toBe('second task prompt');
  });

  it('removes the task it names, after an earlier one was removed', async () => {
    const db = statefulDb(withTasks());
    await removeTask('p1', 'id-a', db as never);
    await removeTask('p1', 'id-c', db as never);
    expect(db.current().stages.exploration.phases.discover.tasks.map((t) => t.id)).toEqual(['id-b']);
  });

  /** A rail loaded before the ids existed still works — and heals as it goes. */
  it('accepts the legacy positional id for a task that has no id yet', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [
      { kind: 'journal', prompt: 'legacy one prompt', status: 'draft', attempts: [] },
      { kind: 'journal', prompt: 'legacy two prompt', status: 'draft', attempts: [] },
    ];
    const db = statefulDb(d);
    await editTask('p1', 'task-1', { prompt: 'edited the second legacy task' }, db as never);

    const tasks = db.current().stages.exploration.phases.discover.tasks;
    expect(tasks[1]!.prompt).toBe('edited the second legacy task');
    expect(tasks[0]!.prompt).toBe('legacy one prompt');
    // …and every task now carries a real id, so the next call is position-independent.
    expect(tasks.every((t) => t.id && !/^task-\d+$/.test(t.id))).toBe(true);
  });

  it('will not let a positional id address a task that already has one', async () => {
    const d = withTasks();
    await expect(editTask('p1', 'task-0', { prompt: 'should not land anywhere' }, statefulDb(d) as never))
      .rejects.toBeInstanceOf(TaskNotFoundError);
  });
});
