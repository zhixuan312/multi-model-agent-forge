// @vitest-environment node
import { afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { proposeFanOut } from '@/exploration/fan-out';
import { mockAnthropic } from './mock-anthropic';
import { seedProject, seedRepo, cleanupExploreFixtures } from './db-fixtures';

async function seedBrief(projectId: string, body: string): Promise<void> {
  await getDb().insert(artifact).values({ projectId, kind: 'exploration_brief', bodyMd: body, version: 1 });
}

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('proposeFanOut', () => {
  afterEach(async () => {
    await cleanupExploreFixtures();
  });

  it('proposes N investigate + M research + K journal draft rows', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await seedBrief(projectId, 'We want to add caching to the API.');

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [
            {
              tasks: [
                { kind: 'investigate', targetRepoId: repo.id, prompt: 'how does the API cache today?' },
                { kind: 'research', targetRepoId: null, prompt: 'what caching strategies fit our stack?' },
                { kind: 'journal', targetRepoId: null, prompt: 'what did we decide about caching before?' },
              ],
            },
          ],
        },
      }),
    });

    expect(res.failed).toBe(false);
    expect(res.inserted).toHaveLength(3);
    const rows = await getDb()
      .select({ kind: explorationTask.kind, status: explorationTask.status })
      .from(explorationTask)
      .where(eq(explorationTask.projectId, projectId));
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
    expect(rows.map((r) => r.kind).sort()).toEqual(['investigate', 'journal', 'research']);
  });

  it('drops an invalid kind and an out-of-subset repo (F27) — never inserts malformed rows', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    await seedBrief(projectId, 'caching');

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [
            {
              tasks: [
                { kind: 'investigate', targetRepoId: repo.id, prompt: 'a valid investigate' },
                { kind: 'bogus', targetRepoId: null, prompt: 'invalid kind here' },
                { kind: 'investigate', targetRepoId: 'not-in-subset', prompt: 'wrong repo' },
                { kind: 'research', targetRepoId: repo.id, prompt: 'research with a repo is invalid here' },
              ],
            },
          ],
        },
      }),
    });

    // Only the one valid investigate survives.
    expect(res.inserted).toHaveLength(1);
    expect(res.inserted[0]).toMatchObject({ kind: 'investigate', targetRepoId: repo.id });
  });

  it('re-asks ONCE for a sub-floor prompt, keeps it if repaired', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedBrief(projectId, 'x');
    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [{ tasks: [{ kind: 'research', targetRepoId: null, prompt: 'short' }] }],
          'proposeFanOut.repair': [{ prompt: 'what external approaches address this problem well?' }],
        },
      }),
    });
    expect(res.inserted).toHaveLength(1);
    expect(res.inserted[0].prompt).toMatch(/external approaches/);
  });

  it('drops a task whose re-ask STILL returns a sub-floor prompt (bounded — one re-ask)', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedBrief(projectId, 'x');
    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [{ tasks: [{ kind: 'research', targetRepoId: null, prompt: 'short' }] }],
          'proposeFanOut.repair': [{ prompt: 'still short' }],
        },
      }),
    });
    expect(res.inserted).toHaveLength(0);
  });

  it('a failed/unparseable orchestrator response inserts ZERO rows (F31)', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedBrief(projectId, 'x');
    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({ byCall: {}, throwOn: new Set(['proposeFanOut']) }),
    });
    expect(res.failed).toBe(true);
    expect(res.inserted).toHaveLength(0);
    const rows = await getDb().select().from(explorationTask).where(eq(explorationTask.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it('an empty fan-out (zero tasks) inserts nothing and is not a failure', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedBrief(projectId, 'x');
    const res = await proposeFanOut(projectId, { id: ownerId }, {
      anthropic: mockAnthropic({ byCall: { proposeFanOut: [{ tasks: [] }] } }),
    });
    expect(res.failed).toBe(false);
    expect(res.inserted).toHaveLength(0);
  });
});
