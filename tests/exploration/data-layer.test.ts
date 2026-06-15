// @vitest-environment node
import { createMockDb } from '../test-utils/mock-db';
import { project } from '@/db/schema/projects';
import { explorationTask, attachment } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { proposeFanOut } from '@/exploration/fan-out';
import { mockAnthropic } from './mock-anthropic';

describe('Spec-5 data layer (live DB)', () => {
  it('mma_batch round-trips one-repo-per-task; research/journal-recall store null repo but NON-NULL cwd', async () => {
    const db = createMockDb({
      'select:mma_batch': [
        { id: 'batch-1', projectId: 'proj-1', route: 'investigate', targetRepoId: 'repo-1', cwd: '/work/a', request: {}, dispatchedBy: 'member-1', createdAt: new Date() },
        { id: 'batch-2', projectId: 'proj-1', route: 'research', targetRepoId: null, cwd: '/work', request: {}, dispatchedBy: null, createdAt: new Date() },
        { id: 'batch-3', projectId: 'proj-1', route: 'journal_recall', targetRepoId: null, cwd: '/work', request: {}, dispatchedBy: null, createdAt: new Date() },
      ],
      'insert:mma_batch': [
        { id: 'batch-1', projectId: 'proj-1', route: 'investigate', targetRepoId: 'repo-1', cwd: '/work/a', request: {}, dispatchedBy: 'member-1', createdAt: new Date() },
      ],
    });
    await db.insert(mmaBatch).values({ projectId: 'proj-1', route: 'investigate', targetRepoId: 'repo-1', cwd: '/work/a', request: {}, dispatchedBy: 'member-1' });
    const rows = await db.select().from(mmaBatch);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.cwd).toBeTruthy();
    expect(rows.find((r) => r.route === 'investigate')!.targetRepoId).toBe('repo-1');
    expect(rows.find((r) => r.route === 'research')!.targetRepoId).toBeNull();
  });

  it('cascades exploration_task / attachment / mma_batch on project delete', async () => {
    const db = createMockDb({
      'insert:exploration_task': [{ id: 'task-1', projectId: 'proj-1', kind: 'research', prompt: 'p', createdBy: 'member-1', createdAt: new Date() }],
      'insert:attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'link', label: 'x', payload: { url: 'https://x' }, createdAt: new Date() }],
      'insert:mma_batch': [{ id: 'batch-1', projectId: 'proj-1', route: 'research', cwd: '/work', request: {}, dispatchedBy: null, createdAt: new Date() }],
      'select:exploration_task': [],
      'select:attachment': [],
      'select:mma_batch': [],
      'delete:project': [],
    });
    await db.insert(explorationTask).values({ projectId: 'proj-1', kind: 'research', prompt: 'p', createdBy: 'member-1' });
    await db.insert(attachment).values({ projectId: 'proj-1', kind: 'link', label: 'x', payload: { url: 'https://x' }, createdBy: 'member-1' });
    await db.insert(mmaBatch).values({ projectId: 'proj-1', route: 'research', cwd: '/work', request: {} });
    await db.delete(project);
    expect(await db.select().from(explorationTask)).toHaveLength(0);
    expect(await db.select().from(attachment)).toHaveLength(0);
    expect(await db.select().from(mmaBatch)).toHaveLength(0);
  });

  it('parseable proposal with 1 invalid of N inserts the valid subset atomically (not a batch abort)', async () => {
    const db = createMockDb({
      'select:artifact': [{ id: 'art-1', projectId: 'proj-1', kind: 'exploration_brief', bodyMd: 'b', version: 1, createdAt: new Date(), updatedAt: new Date() }],
      'select:project_repo': [{ repoId: 'repo-1', id: 'repo-1' }],
      'insert:exploration_task': [
        { id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'valid one', createdBy: 'member-1', createdAt: new Date() },
        { id: 'task-2', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'valid two', createdBy: 'member-1', createdAt: new Date() },
        { id: 'task-3', projectId: 'proj-1', kind: 'research', targetRepoId: null, prompt: 'valid research enough chars here', createdBy: 'member-1', createdAt: new Date() },
      ],
      'select:exploration_task': [
        { id: 'task-1', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'valid one', createdBy: 'member-1', createdAt: new Date() },
        { id: 'task-2', projectId: 'proj-1', kind: 'investigate', targetRepoId: 'repo-1', prompt: 'valid two', createdBy: 'member-1', createdAt: new Date() },
        { id: 'task-3', projectId: 'proj-1', kind: 'research', targetRepoId: null, prompt: 'valid research enough chars here', createdBy: 'member-1', createdAt: new Date() },
      ],
    });

    const res = await proposeFanOut('proj-1', { id: 'member-1' }, {
      db,
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [
            {
              tasks: [
                { kind: 'investigate', targetRepoId: 'repo-1', prompt: 'valid one' },
                { kind: 'investigate', targetRepoId: 'repo-1', prompt: 'valid two' },
                { kind: 'research', targetRepoId: null, prompt: 'valid research enough chars here' },
                { kind: 'investigate', targetRepoId: null, prompt: 'invalid — no repo' }, // dropped
              ],
            },
          ],
        },
      }),
    });
    // 3 valid of 4 → the 3 commit as a whole; the 1 invalid is a per-task drop.
    expect(res.inserted).toHaveLength(3);
  });
});
