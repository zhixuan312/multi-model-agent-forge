// @vitest-environment node
import { afterEach } from 'vitest';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { repo as reposchema } from '@/db/schema/workspace';
import { synthesize } from '@/exploration/synthesize';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { mockAnthropic } from './mock-anthropic';
import { seedProject, seedRepo, cleanupExploreFixtures } from './db-fixtures';

/** Seed a recorded task + its terminal mma_batch (done|failed). */
async function seedRecorded(opts: {
  projectId: string;
  ownerId: string;
  route: 'investigate' | 'research' | 'journal_recall';
  status: 'done' | 'failed';
  targetRepoId?: string | null;
  headline?: string;
}): Promise<void> {
  const db = getDb();
  const [b] = await db
    .insert(mmaBatch)
    .values({
      projectId: opts.projectId,
      route: opts.route,
      targetRepoId: opts.targetRepoId ?? null,
      cwd: '/work',
      batchId: 'mma-x',
      status: opts.status,
      request: {},
      result: { headline: opts.headline ?? 'ok', structuredReport: { summary: 's' } },
      terminalAt: new Date(),
    })
    .returning({ id: mmaBatch.id });
  await db.insert(explorationTask).values({
    projectId: opts.projectId,
    kind: opts.route === 'journal_recall' ? 'journal' : (opts.route as 'investigate' | 'research'),
    targetRepoId: opts.targetRepoId ?? null,
    prompt: 'p',
    status: 'recorded',
    mmaBatchId: b.id,
    createdBy: opts.ownerId,
  });
}

const synthOutput = {
  background: 'The work is about X.',
  currentState: 'Today the system does Y.',
  roughDirection: 'Move toward Z.',
};

describe('synthesize', () => {
  afterEach(async () => {
    await cleanupExploreFixtures();
  });

  it('writes artifact(kind=exploration) v1 with the three sections + emits synthesis.updated', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedRecorded({ projectId, ownerId, route: 'investigate', status: 'done' });
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const res = await synthesize(projectId, { id: ownerId }, {
      bus,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res).toMatchObject({ ok: true, version: 1 });

    const [a] = await getDb()
      .select({ bodyMd: artifact.bodyMd, version: artifact.version })
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')))
      .orderBy(desc(artifact.version));
    expect(a.version).toBe(1);
    expect(a.bodyMd).toContain('## Background');
    expect(a.bodyMd).toContain('## Current state');
    expect(a.bodyMd).toContain('## Rough direction');
    expect(events.some((e) => e.type === 'synthesis.updated')).toBe(true);
  });

  it('re-synthesis bumps version; latest is returned by (project,kind,version desc)', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedRecorded({ projectId, ownerId, route: 'research', status: 'done' });
    const deps = { bus: new ProjectEventBus(), anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput, synthOutput] } }) };
    const r1 = await synthesize(projectId, { id: ownerId }, deps);
    const r2 = await synthesize(projectId, { id: ownerId }, deps);
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);

    const [latest] = await getDb()
      .select({ version: artifact.version })
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')))
      .orderBy(desc(artifact.version))
      .limit(1);
    expect(latest.version).toBe(2);
  });

  it('a failed task yields an explicit gap marker in Current state naming its route + repo', async () => {
    const repo = await seedRepo('api', '/work/api');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    // Resolve the repo's actual (unique) name for the marker assertion.
    const [repoRow] = await getDb().select({ name: reposchema.name }).from(reposchema).where(eq(reposchema.id, repo.id));
    await seedRecorded({ projectId, ownerId, route: 'investigate', status: 'done' });
    await seedRecorded({ projectId, ownerId, route: 'investigate', status: 'failed', targetRepoId: repo.id });

    const res = await synthesize(projectId, { id: ownerId }, {
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res.ok).toBe(true);
    const [a] = await getDb()
      .select({ bodyMd: artifact.bodyMd })
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(a.bodyMd).toContain(`(investigate · repo \`${repoRow.name}\`: failed — findings unavailable)`);
  });

  it('a synthesis call failure retains the prior version + suppresses synthesis.updated (F31)', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedRecorded({ projectId, ownerId, route: 'research', status: 'done' });
    // First a good pass → v1.
    await synthesize(projectId, { id: ownerId }, {
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    // Then a failing pass.
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));
    const res = await synthesize(projectId, { id: ownerId }, {
      bus,
      anthropic: mockAnthropic({ byCall: {}, throwOn: new Set(['synthesizeExploration']) }),
    });
    expect(res.ok).toBe(false);
    expect(events.some((e) => e.type === 'synthesis.updated')).toBe(false);

    const versions = await getDb()
      .select({ version: artifact.version })
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(versions).toHaveLength(1); // no new version written
    expect(versions[0].version).toBe(1);
  });

  it('returns ok:false when no recorded tasks exist yet', async () => {
    const { projectId, ownerId } = await seedProject();
    const res = await synthesize(projectId, { id: ownerId }, {
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res.ok).toBe(false);
  });
});
