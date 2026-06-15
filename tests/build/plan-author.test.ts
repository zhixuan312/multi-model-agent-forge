// @vitest-environment node
import { afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { planTask } from '@/db/schema/build';
import { authorPlan, getLatestPlanArtifact } from '@/build/plan-author';
import { AnthropicClient } from '@/anthropic/client';
import { planFilePath } from '@/build/plan-fs';
import { seedProject, seedRepo, seedSpec, cleanupBuildFixtures, RecordingBus, FakePlanFs } from './fixtures';
import type { PlanDraft } from '@/build/plan-schema';

const anthropicStub = {} as unknown as AnthropicClient; // never called (draftOverride bypasses it)

function draft(tasks: PlanDraft['tasks']): PlanDraft {
  return { tasks };
}

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('authorPlan', () => {
  afterEach(cleanupBuildFixtures);

  it('decomposes one repo per task, writes a plan file per write-target repo, persists rows + artifact', async () => {
    const a = await seedRepo('a', '/work/a');
    const b = await seedRepo('b', '/work/b');
    const { projectId, ownerId } = await seedProject({ repoIds: [a.id, b.id] });
    await seedSpec(projectId);
    const fs = new FakePlanFs();
    const bus = new RecordingBus();

    const res = await authorPlan(
      {
        db: getDb(),
        anthropic: anthropicStub,
        fs,
        bus,
        draftOverride: draft([
          { title: 'Task 1: Cache', detail: 'add caching to A', targetRepoId: a.id, dependsOn: [], reviewPolicy: 'full' },
          { title: 'Task 2: Read-only? no, write B', detail: 'wire B', targetRepoId: b.id, dependsOn: ['Task 1: Cache'], reviewPolicy: 'full' },
        ]),
      },
      { projectId, actorId: ownerId },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.writeTargets.sort()).toEqual([a.name, b.name].sort());
    expect(res.taskCount).toBe(2);

    // Plan file per write-target repo, under <repo>/.forge/, with verbatim ATX headings.
    const aFile = fs.files.get(planFilePath('/work/a', projectId));
    expect(aFile).toContain('## Task 1: Cache');
    expect(aFile).not.toMatch(/git (commit|add|push)/);

    // plan_task rows persisted (queued), depends_on wired by id.
    const rows = await getDb().select().from(planTask).where(eq(planTask.projectId, projectId));
    expect(rows).toHaveLength(2);
    const cache = rows.find((r) => r.title === 'Task 1: Cache')!;
    const wire = rows.find((r) => r.title.startsWith('Task 2'))!;
    expect(wire.dependsOn).toEqual([cache.id]);
    expect(rows.every((r) => r.status === 'queued' && r.isWrite)).toBe(true);

    // Combined plan artifact persisted.
    const art = await getLatestPlanArtifact(getDb(), projectId);
    expect(art?.kind).toBe('plan');
    expect(art?.version).toBe(1);

    // plan.authored emitted.
    expect(bus.ofType('plan.authored')).toHaveLength(1);
  });

  it('write/read split: a repo with no task is read-only', async () => {
    const a = await seedRepo('a', '/work/a');
    const metrics = await seedRepo('metrics', '/work/metrics');
    const { projectId, ownerId } = await seedProject({ repoIds: [a.id, metrics.id] });
    await seedSpec(projectId);
    const res = await authorPlan(
      { db: getDb(), anthropic: anthropicStub, fs: new FakePlanFs(), bus: new RecordingBus(), draftOverride: draft([{ title: 'Only A', detail: 'do', targetRepoId: a.id, dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId, actorId: ownerId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.writeTargets).toEqual([a.name]);
    expect(res.readOnly).toEqual([metrics.name]);
  });

  it('re-authoring increments the artifact version', async () => {
    const a = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [a.id] });
    await seedSpec(projectId);
    const mk = () =>
      authorPlan(
        { db: getDb(), anthropic: anthropicStub, fs: new FakePlanFs(), bus: new RecordingBus(), draftOverride: draft([{ title: 'A', detail: 'd', targetRepoId: a.id, dependsOn: [], reviewPolicy: 'full' }]) },
        { projectId, actorId: ownerId },
      );
    await mk();
    const second = await mk();
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.version).toBe(2);
  });

  it('unknown targetRepoId → plan.failed, no partial rows', async () => {
    const a = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [a.id] });
    await seedSpec(projectId);
    const bus = new RecordingBus();
    const res = await authorPlan(
      { db: getDb(), anthropic: anthropicStub, fs: new FakePlanFs(), bus, draftOverride: draft([{ title: 'X', detail: 'd', targetRepoId: 'unknown-repo', dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId, actorId: ownerId },
    );
    expect(res.ok).toBe(false);
    expect(bus.ofType('plan.failed')).toHaveLength(1);
    const rows = await getDb().select().from(planTask).where(eq(planTask.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it('git-commit step in a task body → plan.failed, no rows', async () => {
    const a = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [a.id] });
    await seedSpec(projectId);
    const res = await authorPlan(
      { db: getDb(), anthropic: anthropicStub, fs: new FakePlanFs(), bus: new RecordingBus(), draftOverride: draft([{ title: 'X', detail: 'then git commit -m done', targetRepoId: a.id, dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId, actorId: ownerId },
    );
    expect(res.ok).toBe(false);
    const rows = await getDb().select().from(planTask).where(eq(planTask.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it('plan-file write failure halts before any dispatch, no rows persisted', async () => {
    const a = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [a.id] });
    await seedSpec(projectId);
    const fs = new FakePlanFs();
    fs.failWriteOn = '.forge';
    const res = await authorPlan(
      { db: getDb(), anthropic: anthropicStub, fs, bus: new RecordingBus(), draftOverride: draft([{ title: 'A', detail: 'd', targetRepoId: a.id, dependsOn: [], reviewPolicy: 'full' }]) },
      { projectId, actorId: ownerId },
    );
    expect(res.ok).toBe(false);
    const rows = await getDb().select().from(planTask).where(eq(planTask.projectId, projectId));
    expect(rows).toHaveLength(0);
    const art = await getDb().select().from(artifact).where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'plan')));
    expect(art).toHaveLength(0);
  });
});
