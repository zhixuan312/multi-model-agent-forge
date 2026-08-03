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
    expect(id).toBe('task-0');
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
    await expect(editTask('proj-6', 0, { prompt: 'a different question entirely' }, mockDb))
      .rejects.toBeInstanceOf(TaskLockedError);
  });

  it('removing a task index that does not exist fails instead of quietly succeeding', async () => {
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: 'proj-7' }],
    });
    await expect(removeTask('proj-7', 4, mockDb)).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(mockDb._wasCalled('project', 'update')).toBe(false);
  });
});
