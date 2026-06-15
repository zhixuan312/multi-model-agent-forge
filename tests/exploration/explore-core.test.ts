// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { projectRepo } from '@/db/schema/projects';
import {
  saveBrief,
  latestBrief,
  readRailTasks,
  latestExplorationArtifact,
  addTask,
  editTask,
  removeTask,
  TaskLockedError,
} from '@/exploration/explore-core';
import { createMockDb, seq } from '../test-utils/mock-db';

describe('brief persistence', () => {
  it('saves the brain-dump as exploration_brief; re-save bumps version; latest read wins', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const mockDb = createMockDb({
      'select:artifact': seq([], [{ v: 1 }], [{ bodyMd: 'second dump' }]),
      'insert:artifact': seq([{ id: 'art-1', projectId, kind: 'exploration_brief', version: 1, bodyMd: 'first dump' }], [{ id: 'art-2', projectId, kind: 'exploration_brief', version: 2, bodyMd: 'second dump' }]),
    });

    const r1 = await saveBrief(projectId, 'first dump', { id: ownerId }, mockDb);
    const r2 = await saveBrief(projectId, 'second dump', { id: ownerId }, mockDb);
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    const latest = await latestBrief(projectId, mockDb);
    expect(latest).toBe('second dump');
  });
});

describe('rail + summary reads', () => {
  it('joins exploration_task to mma_batch for live status/headline/error', async () => {
    const projectId = 'proj-2';
    const ownerId = 'owner-2';
    const mockDb = createMockDb({
      'select:exploration_task': [
        {
          id: 'task-1',
          projectId,
          kind: 'investigate',
          targetRepoId: null,
          prompt: 'p',
          status: 'recorded',
          mmaBatchId: 'batch-1',
          batchStatus: 'failed',
          result: { headline: 'oops', error: { code: 'e', message: 'boom' } },
          createdBy: ownerId,
        },
      ],
      'select:mma_batch': [
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
    expect(rail[0]).toMatchObject({ batchStatus: 'failed', headline: 'oops', error: { code: 'e', message: 'boom' } });
  });

  it('latestExplorationArtifact returns the highest version', async () => {
    const projectId = 'proj-3';
    const mockDb = createMockDb({
      'select:artifact': [
        { id: 'art-2', projectId, kind: 'exploration', bodyMd: 'v2', version: 2, createdAt: new Date() },
        { id: 'art-1', projectId, kind: 'exploration', bodyMd: 'v1', version: 1, createdAt: new Date() },
      ],
    });

    const a = await latestExplorationArtifact(projectId, mockDb);
    expect(a).toMatchObject({ version: 2, bodyMd: 'v2' });
  });
});

describe('task editing + reversibility', () => {
  it('adds a manual research draft task', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const mockDb = createMockDb({
      'insert:exploration_task': [{ id: 'task-1', projectId, kind: 'research', targetRepoId: null, prompt: 'what external options exist for this?', status: 'draft', createdBy: ownerId }],
    });

    const { id } = await addTask(projectId, { kind: 'research', prompt: 'what external options exist for this?' }, { id: ownerId }, mockDb);
    expect(id).toBe('task-1');
  });

  it('rejects an investigate add with an out-of-subset repo', async () => {
    const projectId = 'proj-5';
    const ownerId = 'owner-5';
    const mockDb = createMockDb({
      'select:project_repo': [],
    });

    await expect(
      addTask(projectId, { kind: 'investigate', targetRepoId: 'nope', prompt: 'x?' }, { id: ownerId }, mockDb),
    ).rejects.toThrow(TaskLockedError);
  });

  it('edits a draft prompt + swaps a target repo', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';
    const repoA = 'repo-a';
    const repoB = 'repo-b';
    const taskId = 'task-1';

    const mockDb = createMockDb({
      'select:project_repo': seq(
        [{ id: repoA, name: 'Repo A' }, { id: repoB, name: 'Repo B' }],
        [{ id: repoA, name: 'Repo A' }, { id: repoB, name: 'Repo B' }],
      ),
      'select:exploration_task': seq(
        [{ id: taskId, projectId, kind: 'investigate', targetRepoId: repoA, prompt: 'how?', status: 'draft', createdBy: ownerId }],
        [{ id: taskId, projectId, kind: 'investigate', targetRepoId: repoB, prompt: 'how does it really work?', status: 'draft', createdBy: ownerId }],
      ),
      'insert:exploration_task': [{ id: taskId }],
      'update:exploration_task': [{ id: taskId, projectId, kind: 'investigate', targetRepoId: repoB, prompt: 'how does it really work?', status: 'draft', createdBy: ownerId }],
    });

    await addTask(projectId, { kind: 'investigate', targetRepoId: repoA, prompt: 'how does this repository support the checkout flow?' }, { id: ownerId }, mockDb);
    await editTask(projectId, taskId, { prompt: 'how does it really work?', targetRepoId: repoB }, { id: ownerId }, mockDb);
    expect(mockDb._assertCalled('exploration_task', 'update')).toBe(true);
  });

  it('rejects editing a recorded (locked) task', async () => {
    const projectId = 'proj-7';
    const ownerId = 'owner-7';
    const taskId = 'task-1';

    const mockDb = createMockDb({
      'select:exploration_task': [{ id: taskId, projectId, kind: 'research', targetRepoId: null, prompt: 'p', status: 'recorded', createdBy: ownerId }],
    });

    await expect(editTask(projectId, taskId, { prompt: 'new prompt long enough' }, { id: ownerId }, mockDb)).rejects.toThrow(TaskLockedError);
    await expect(removeTask(projectId, taskId, { id: ownerId }, mockDb)).rejects.toThrow(TaskLockedError);
  });

  it('removes a draft task', async () => {
    const projectId = 'proj-8';
    const ownerId = 'owner-8';
    const taskId = 'task-1';

    const mockDb = createMockDb({
      'insert:exploration_task': [{ id: taskId, projectId, kind: 'journal', targetRepoId: null, prompt: 'what was decided?', status: 'draft', createdBy: ownerId }],
      'select:exploration_task': [{ id: taskId, projectId, kind: 'journal', targetRepoId: null, prompt: 'what was decided?', status: 'draft', createdBy: ownerId }],
      'delete:exploration_task': [],
    });

    const { id } = await addTask(projectId, { kind: 'journal', prompt: 'what was decided?' }, { id: ownerId }, mockDb);
    await removeTask(projectId, id, { id: ownerId }, mockDb);
    expect(mockDb._assertCalled('exploration_task', 'delete')).toBe(true);
  });
});
