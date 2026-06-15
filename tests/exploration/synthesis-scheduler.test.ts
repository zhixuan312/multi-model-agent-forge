// @vitest-environment node
import { vi, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { SynthesisScheduler } from '@/exploration/synthesis-scheduler';
import { ProjectEventBus } from '@/sse/event-bus';
import { mockAnthropic } from './mock-anthropic';
import { createMockDb, seq } from '../test-utils/mock-db';

const synthOutput = { background: 'b', currentState: 'c', roughDirection: 'd' };
const projectId = 'proj-1';
const ownerId = 'owner-1';

describe('SynthesisScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: a burst of terminal events coalesces into ONE synthesis after the quiet window (F6)', async () => {
    const mockDb = createMockDb({
      'select:exploration_task': seq(
        [{ projectId, total: 1, recorded: 1, latestTerminal: new Date() }],
        [
          {
            taskId: 'task-1',
            projectId,
            kind: 'research',
            prompt: 'p',
            route: 'research',
            batchStatus: 'done',
            result: { headline: 'ok' },
            repoName: null,
          },
        ],
      ),
      'select:mma_batch': [
        {
          id: 'batch-1',
          projectId,
          route: 'research',
          cwd: '/work',
          batchId: 'mma',
          status: 'done',
          request: {},
          result: { headline: 'ok' },
          terminalAt: new Date(),
        },
      ],
      'insert:artifact': [{ id: 'art-1', projectId, kind: 'exploration', version: 1, bodyMd: 'synthesis' }],
      'select:artifact': seq(
        [],
        [
          {
            id: 'art-1',
            projectId,
            kind: 'exploration',
            version: 1,
            bodyMd: 'synthesis',
          },
        ],
      ),
    });

    const bus = new ProjectEventBus();
    const sched = new SynthesisScheduler({
      db: mockDb,
      bus,
      debounceMs: 60_000,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    sched.watch(projectId);

    bus.publish(projectId, { type: 'task.done', taskId: 't1', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    expect(sched.isArmed(projectId)).toBe(true);
    bus.publish(projectId, { type: 'task.done', taskId: 't2', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    bus.publish(projectId, { type: 'task.failed', taskId: 't3', mmaBatchId: 'b', route: 'research', error: { code: 'x', message: 'y' } });
    expect(sched.isArmed(projectId)).toBe(true);

    await sched.flush(projectId);
    expect(sched.isArmed(projectId)).toBe(false);
    sched.shutdown();

    const arts = await mockDb
      .select({ version: artifact.version })
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(arts).toHaveLength(1);
  });

  it('fires synthesis automatically when the debounce window elapses', async () => {
    const mockDb = createMockDb({
      'select:exploration_task': seq(
        [{ projectId, total: 1, recorded: 1, latestTerminal: new Date() }],
        [
          {
            taskId: 'task-1',
            projectId,
            kind: 'research',
            prompt: 'p',
            route: 'research',
            batchStatus: 'done',
            result: { headline: 'ok' },
            repoName: null,
          },
        ],
      ),
      'select:mma_batch': [
        {
          id: 'batch-1',
          projectId,
          route: 'research',
          cwd: '/work',
          batchId: 'mma',
          status: 'done',
          request: {},
          result: { headline: 'ok' },
          terminalAt: new Date(),
        },
      ],
      'insert:artifact': [{ id: 'art-1', projectId, kind: 'exploration', version: 1, bodyMd: 'synthesis' }],
      'select:artifact': [
        {
          id: 'art-1',
          projectId,
          kind: 'exploration',
          version: 1,
          bodyMd: 'synthesis',
        },
      ],
    });

    const bus = new ProjectEventBus();
    const sched = new SynthesisScheduler({
      db: mockDb,
      bus,
      debounceMs: 20,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    sched.watch(projectId);
    bus.publish(projectId, { type: 'task.done', taskId: 't1', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    await new Promise((r) => setTimeout(r, 80));
    sched.shutdown();

    const arts = await mockDb
      .select()
      .from(artifact)
      .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
    expect(arts).toHaveLength(1);
  });

  it('boot reconciliation sweep synthesizes a project owed a final pass (F24)', async () => {
    const mockDb = createMockDb({
      'select:exploration_task': seq(
        [{ projectId, total: 1, recorded: 1, latestTerminal: new Date() }],
        [{ taskId: 'task-1', projectId, kind: 'research', prompt: 'p', route: 'research', batchStatus: 'done', result: { headline: 'ok' }, repoName: null }],
      ),
      'select:mma_batch': [
        {
          id: 'batch-1',
          projectId,
          route: 'research',
          cwd: '/work',
          batchId: 'mma',
          status: 'done',
          request: {},
          result: { headline: 'ok' },
          terminalAt: new Date(),
        },
      ],
      'select:artifact': seq([], [{ v: 0 }]),
      'insert:artifact': [{ id: 'art-1' }],
    });

    const sched = new SynthesisScheduler({
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).toContain(projectId);
  });

  it('leaves a project whose latest artifact already post-dates its tasks untouched (F24)', async () => {
    const past = new Date(Date.now() - 60_000);
    const mockDb = createMockDb({
      'select:exploration_task': [
        {
          id: 'task-1',
          projectId,
          kind: 'research',
          prompt: 'p',
          status: 'recorded',
          mmaBatchId: 'batch-1',
          createdBy: ownerId,
        },
      ],
      'select:mma_batch': [
        {
          id: 'batch-1',
          projectId,
          route: 'research',
          cwd: '/work',
          batchId: 'mma',
          status: 'done',
          request: {},
          result: { headline: 'ok' },
          terminalAt: past,
        },
      ],
      'select:artifact': seq(
        [
          {
            id: 'art-1',
            projectId,
            kind: 'exploration',
            version: 1,
            bodyMd: '## Background',
            createdAt: new Date(),
          },
        ],
        [
          {
            id: 'art-1',
            projectId,
            kind: 'exploration',
            version: 1,
            bodyMd: '## Background',
            createdAt: new Date(),
          },
        ],
      ),
    });

    const sched = new SynthesisScheduler({
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).not.toContain(projectId);
  });
});
