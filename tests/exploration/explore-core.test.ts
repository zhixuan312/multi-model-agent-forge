// @vitest-environment node
import { afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
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
import { seedProject, seedRepo, cleanupExploreFixtures } from './db-fixtures';

afterEach(async () => {
  await cleanupExploreFixtures();
});

describe('brief persistence', () => {
  it('saves the brain-dump as exploration_brief; re-save bumps version; latest read wins', async () => {
    const { projectId, ownerId } = await seedProject();
    const r1 = await saveBrief(projectId, 'first dump', { id: ownerId });
    const r2 = await saveBrief(projectId, 'second dump', { id: ownerId });
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    expect(await latestBrief(projectId)).toBe('second dump');
  });
});

describe('rail + summary reads', () => {
  it('joins exploration_task to mma_batch for live status/headline/error', async () => {
    const { projectId, ownerId } = await seedProject();
    const [b] = await getDb()
      .insert(mmaBatch)
      .values({
        projectId,
        route: 'investigate',
        cwd: '/work',
        batchId: 'mma',
        status: 'failed',
        request: {},
        result: { headline: 'oops', error: { code: 'e', message: 'boom' } },
      })
      .returning({ id: mmaBatch.id });
    await getDb().insert(explorationTask).values({
      projectId,
      kind: 'investigate',
      prompt: 'p',
      status: 'recorded',
      mmaBatchId: b.id,
      createdBy: ownerId,
    });
    const rail = await readRailTasks(projectId);
    expect(rail[0]).toMatchObject({ batchStatus: 'failed', headline: 'oops', error: { code: 'e', message: 'boom' } });
  });

  it('latestExplorationArtifact returns the highest version', async () => {
    const { projectId } = await seedProject();
    await getDb().insert(artifact).values({ projectId, kind: 'exploration', bodyMd: 'v1', version: 1 });
    await getDb().insert(artifact).values({ projectId, kind: 'exploration', bodyMd: 'v2', version: 2 });
    const a = await latestExplorationArtifact(projectId);
    expect(a).toMatchObject({ version: 2, bodyMd: 'v2' });
  });
});

describe('task editing + reversibility', () => {
  it('adds a manual research draft task', async () => {
    const { projectId, ownerId } = await seedProject();
    const { id } = await addTask(projectId, { kind: 'research', prompt: 'what external options exist for this?' }, { id: ownerId });
    const [t] = await getDb().select({ status: explorationTask.status }).from(explorationTask).where(eq(explorationTask.id, id));
    expect(t.status).toBe('draft');
  });

  it('rejects an investigate add with an out-of-subset repo', async () => {
    const { projectId, ownerId } = await seedProject();
    await expect(
      addTask(projectId, { kind: 'investigate', targetRepoId: 'nope', prompt: 'x?' }, { id: ownerId }),
    ).rejects.toThrow(TaskLockedError);
  });

  it('edits a draft prompt + swaps a target repo', async () => {
    const repoA = await seedRepo('a', '/work/a');
    const repoB = await seedRepo('b', '/work/b');
    const { projectId, ownerId } = await seedProject({ repoIds: [repoA.id, repoB.id] });
    const { id } = await addTask(projectId, { kind: 'investigate', targetRepoId: repoA.id, prompt: 'how?' }, { id: ownerId });
    await editTask(projectId, id, { prompt: 'how does it really work?', targetRepoId: repoB.id }, { id: ownerId });
    const [t] = await getDb()
      .select({ prompt: explorationTask.prompt, targetRepoId: explorationTask.targetRepoId })
      .from(explorationTask)
      .where(eq(explorationTask.id, id));
    expect(t).toMatchObject({ prompt: 'how does it really work?', targetRepoId: repoB.id });
  });

  it('rejects editing a recorded (locked) task', async () => {
    const { projectId, ownerId } = await seedProject();
    const [t] = await getDb()
      .insert(explorationTask)
      .values({ projectId, kind: 'research', prompt: 'p', status: 'recorded', createdBy: ownerId })
      .returning({ id: explorationTask.id });
    await expect(editTask(projectId, t.id, { prompt: 'new prompt long enough' }, { id: ownerId })).rejects.toThrow(TaskLockedError);
    await expect(removeTask(projectId, t.id, { id: ownerId })).rejects.toThrow(TaskLockedError);
  });

  it('removes a draft task', async () => {
    const { projectId, ownerId } = await seedProject();
    const { id } = await addTask(projectId, { kind: 'journal', prompt: 'what was decided?' }, { id: ownerId });
    await removeTask(projectId, id, { id: ownerId });
    const rows = await getDb().select().from(explorationTask).where(eq(explorationTask.id, id));
    expect(rows).toHaveLength(0);
  });
});
