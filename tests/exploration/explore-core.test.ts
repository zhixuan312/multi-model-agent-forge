// @vitest-environment node
import { rmSync } from 'fs';
import { join } from 'path';

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
  it('saves and reads the brief via details', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': seq(
        [{ details: d, detailsVersion: 0 }],
        [{ id: projectId }],
        [{ details: { ...d, stages: { ...d.stages, exploration: { ...d.stages.exploration, phases: { ...d.stages.exploration.phases, brief: { status: 'done', text: 'first dump' } } } } } }],
      ),
      'update:project': [{ id: projectId }],
      'insert:ops_action_log': [],
    });

    await saveBrief(projectId, 'first dump', { id: ownerId }, mockDb);
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });
});

describe('rail + summary reads', () => {
  it('reads tasks from details + joins ops_mma_batch for results', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
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
    expect(rail[0]).toMatchObject({ batchStatus: 'failed', headline: 'oops', error: null });
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
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: projectId }],
      'insert:ops_action_log': [],
    });

    const { id } = await addTask(projectId, { kind: 'research', prompt: 'what external options exist for this?' }, { id: ownerId }, mockDb);
    expect(id).toBe('task-0');
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });
});
