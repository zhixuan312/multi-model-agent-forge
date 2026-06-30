// @vitest-environment node
import { rmSync } from 'fs';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/ops';
import { projectRepo } from '@/db/schema/projects';

afterAll(() => {
  for (const id of ['proj-3']) {
    rmSync(join(process.cwd(), '.forge-workspace', '.mma', 'projects', id), { recursive: true, force: true });
  }
});
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
  it('saves the brain-dump to project.brief_md and reads it back', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const mockDb = createMockDb({
      'update:project': [],
      'select:project': [{ briefMd: 'second dump' }],
      'insert:ops_action_log': [],
    });

    await saveBrief(projectId, 'first dump', { id: ownerId }, mockDb);
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
    const latest = await latestBrief(projectId, mockDb);
    expect(latest).toBe('second dump');
  });
});

describe('rail + summary reads', () => {
  it('joins project_exploration_task to ops_mma_batch for live status/headline/error', async () => {
    const projectId = 'proj-2';
    const ownerId = 'owner-2';
    const mockDb = createMockDb({
      'select:project_exploration_task': [
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
    expect(rail[0]).toMatchObject({ batchStatus: 'failed', headline: 'oops', error: { code: 'e', message: 'boom' } });
  });

  it('latestExplorationArtifact reads from file', async () => {
    const projectId = 'proj-3';
    const { writeExplorationSummary } = await import('@/projects/project-files');
    writeExplorationSummary(projectId, '## Background\n\nTest content');
    const a = await latestExplorationArtifact(projectId);
    expect(a).not.toBeNull();
    expect(a!.bodyMd).toContain('Test content');
  });
});

describe('task editing + reversibility', () => {
  it('adds a manual research draft task', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const mockDb = createMockDb({
      'insert:project_exploration_task': [{ id: 'task-1', projectId, kind: 'research', targetRepoId: null, prompt: 'what external options exist for this?', status: 'draft', createdBy: ownerId }],
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
      'select:project_exploration_task': seq(
        [{ id: taskId, projectId, kind: 'investigate', targetRepoId: repoA, prompt: 'how?', status: 'draft', createdBy: ownerId }],
        [{ id: taskId, projectId, kind: 'investigate', targetRepoId: repoB, prompt: 'how does it really work?', status: 'draft', createdBy: ownerId }],
      ),
      'insert:project_exploration_task': [{ id: taskId }],
      'update:project_exploration_task': [{ id: taskId, projectId, kind: 'investigate', targetRepoId: repoB, prompt: 'how does it really work?', status: 'draft', createdBy: ownerId }],
    });

    await addTask(projectId, { kind: 'investigate', targetRepoId: repoA, prompt: 'how does this repository support the checkout flow?' }, { id: ownerId }, mockDb);
    await editTask(projectId, taskId, { prompt: 'how does it really work?', targetRepoId: repoB }, { id: ownerId }, mockDb);
    expect(mockDb._assertCalled('project_exploration_task', 'update')).toBe(true);
  });

  it('rejects editing a recorded (locked) task', async () => {
    const projectId = 'proj-7';
    const ownerId = 'owner-7';
    const taskId = 'task-1';

    const mockDb = createMockDb({
      'select:project_exploration_task': [{ id: taskId, projectId, kind: 'research', targetRepoId: null, prompt: 'p', status: 'recorded', createdBy: ownerId }],
    });

    await expect(editTask(projectId, taskId, { prompt: 'new prompt long enough' }, { id: ownerId }, mockDb)).rejects.toThrow(TaskLockedError);
    await expect(removeTask(projectId, taskId, { id: ownerId }, mockDb)).rejects.toThrow(TaskLockedError);
  });

  it('removes a draft task', async () => {
    const projectId = 'proj-8';
    const ownerId = 'owner-8';
    const taskId = 'task-1';

    const mockDb = createMockDb({
      'insert:project_exploration_task': [{ id: taskId, projectId, kind: 'journal', targetRepoId: null, prompt: 'what was decided?', status: 'draft', createdBy: ownerId }],
      'select:project_exploration_task': [{ id: taskId, projectId, kind: 'journal', targetRepoId: null, prompt: 'what was decided?', status: 'draft', createdBy: ownerId }],
      'delete:project_exploration_task': [],
    });

    const { id } = await addTask(projectId, { kind: 'journal', prompt: 'what was decided?' }, { id: ownerId }, mockDb);
    await removeTask(projectId, id, { id: ownerId }, mockDb);
    expect(mockDb._assertCalled('project_exploration_task', 'delete')).toBe(true);
  });
});
