// @vitest-environment node
import { afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { explorationTask, attachment } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { proposeFanOut } from '@/exploration/fan-out';
import { mockAnthropic } from './mock-anthropic';
import { seedProject, seedRepo, seedMember, cleanupExploreFixtures } from './db-fixtures';
import { artifact } from '@/db/schema/artifacts';

afterEach(async () => {
  await cleanupExploreFixtures();
});

describe('Spec-5 data layer (live DB)', () => {
  it('mma_batch round-trips one-repo-per-task; research/journal-recall store null repo but NON-NULL cwd', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await getDb().insert(mmaBatch).values([
      { projectId, route: 'investigate', targetRepoId: repo.id, cwd: '/work/a', request: {}, dispatchedBy: ownerId },
      { projectId, route: 'research', targetRepoId: null, cwd: '/work', request: {} },
      { projectId, route: 'journal_recall', targetRepoId: null, cwd: '/work', request: {} },
    ]);
    const rows = await getDb().select().from(mmaBatch).where(eq(mmaBatch.projectId, projectId));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.cwd).toBeTruthy(); // every route carries a cwd
    }
    expect(rows.find((r) => r.route === 'investigate')!.targetRepoId).toBe(repo.id);
    expect(rows.find((r) => r.route === 'research')!.targetRepoId).toBeNull();
  });

  it('cascades exploration_task / attachment / mma_batch on project delete', async () => {
    const { projectId, ownerId } = await seedProject();
    await getDb().insert(explorationTask).values({ projectId, kind: 'research', prompt: 'p', createdBy: ownerId });
    await getDb().insert(attachment).values({ projectId, kind: 'link', label: 'x', payload: { url: 'https://x' }, createdBy: ownerId });
    await getDb().insert(mmaBatch).values({ projectId, route: 'research', cwd: '/work', request: {} });

    await getDb().delete(project).where(eq(project.id, projectId));

    expect(await getDb().select().from(explorationTask).where(eq(explorationTask.projectId, projectId))).toHaveLength(0);
    expect(await getDb().select().from(attachment).where(eq(attachment.projectId, projectId))).toHaveLength(0);
    expect(await getDb().select().from(mmaBatch).where(eq(mmaBatch.projectId, projectId))).toHaveLength(0);
  });

  it('parseable proposal with 1 invalid of N inserts the valid subset atomically (not a batch abort)', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await getDb().insert(artifact).values({ projectId, kind: 'exploration_brief', bodyMd: 'b', version: 1 });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [
            {
              tasks: [
                { kind: 'investigate', targetRepoId: repo.id, prompt: 'valid one' },
                { kind: 'investigate', targetRepoId: repo.id, prompt: 'valid two' },
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
    const rows = await getDb().select().from(explorationTask).where(eq(explorationTask.projectId, projectId));
    expect(rows).toHaveLength(3);
  });
});

void seedMember;
