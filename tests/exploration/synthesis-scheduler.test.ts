// @vitest-environment node
import { afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { SynthesisScheduler } from '@/exploration/synthesis-scheduler';
import { ProjectEventBus } from '@/sse/event-bus';
import { mockAnthropic } from './mock-anthropic';
import { seedProject, cleanupExploreFixtures } from './db-fixtures';

const synthOutput = { background: 'b', currentState: 'c', roughDirection: 'd' };

async function seedRecorded(projectId: string, ownerId: string, terminalAt: Date): Promise<void> {
  const db = getDb();
  const [b] = await db
    .insert(mmaBatch)
    .values({
      projectId,
      route: 'research',
      cwd: '/work',
      batchId: 'mma',
      status: 'done',
      request: {},
      result: { headline: 'ok' },
      terminalAt,
    })
    .returning({ id: mmaBatch.id });
  await db.insert(explorationTask).values({
    projectId,
    kind: 'research',
    prompt: 'p',
    status: 'recorded',
    mmaBatchId: b.id,
    createdBy: ownerId,
  });
}

describe('SynthesisScheduler', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupExploreFixtures();
  });

  it('debounces: a burst of terminal events coalesces into ONE synthesis after the quiet window (F6)', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedRecorded(projectId, ownerId, new Date());

    const bus = new ProjectEventBus();
    // A large debounce window so the timer never fires on its own during the test;
    // we drive the final pass via `flush` (the in-flight-empties path).
    const sched = new SynthesisScheduler({
      bus,
      debounceMs: 60_000,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    sched.watch(projectId);

    // A burst of three terminal events — each resets the single per-project timer.
    bus.publish(projectId, { type: 'task.done', taskId: 't1', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    expect(sched.isArmed(projectId)).toBe(true);
    bus.publish(projectId, { type: 'task.done', taskId: 't2', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    bus.publish(projectId, { type: 'task.failed', taskId: 't3', mmaBatchId: 'b', route: 'research', error: { code: 'x', message: 'y' } });
    expect(sched.isArmed(projectId)).toBe(true); // still one armed timer, not three

    // The final-pass (in-flight empties) flush fires synthesis exactly once.
    await sched.flush(projectId);
    expect(sched.isArmed(projectId)).toBe(false); // timer cleared
    sched.shutdown();

    const arts = await getDb()
      .select({ version: artifact.version })
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(arts).toHaveLength(1); // coalesced into ONE synthesis
  });

  it('fires synthesis automatically when the debounce window elapses', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedRecorded(projectId, ownerId, new Date());
    const bus = new ProjectEventBus();
    const sched = new SynthesisScheduler({
      bus,
      debounceMs: 20, // short real window
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    sched.watch(projectId);
    bus.publish(projectId, { type: 'task.done', taskId: 't1', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    await new Promise((r) => setTimeout(r, 80));
    sched.shutdown();
    const arts = await getDb()
      .select()
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(arts).toHaveLength(1);
  });

  it('boot reconciliation sweep synthesizes a project owed a final pass (F24)', async () => {
    const { projectId, ownerId } = await seedProject();
    // All tasks recorded, terminal_at NOW, but NO exploration artifact yet.
    await seedRecorded(projectId, ownerId, new Date());

    const sched = new SynthesisScheduler({
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).toContain(projectId);
    const arts = await getDb()
      .select()
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(arts).toHaveLength(1);
  });

  it('leaves a project whose latest artifact already post-dates its tasks untouched (F24)', async () => {
    const { projectId, ownerId } = await seedProject();
    const past = new Date(Date.now() - 60_000);
    await seedRecorded(projectId, ownerId, past);
    // An artifact created AFTER the task's terminal_at → not owed.
    await getDb().insert(artifact).values({ projectId, kind: 'exploration', bodyMd: '## Background', version: 1 });

    const sched = new SynthesisScheduler({
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).not.toContain(projectId);
    const arts = await getDb()
      .select()
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(arts).toHaveLength(1); // no redundant pass
  });
});
