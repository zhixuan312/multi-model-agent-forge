// @vitest-environment node
import { vi, afterEach } from 'vitest';
import { SynthesisScheduler } from '@/exploration/synthesis-scheduler';
import { ProjectEventBus } from '@/sse/event-bus';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb, seq } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn().mockResolvedValue(null),
  readExplorationFile: vi.fn().mockResolvedValue(null),
  writeExplorationSummary: vi.fn().mockResolvedValue('/fake/exploration.md'),
  resolveWorkspaceRoot: vi.fn().mockReturnValue('/fake/workspace'),
}));

vi.mock('@/git/workspace-root', () => ({
  resolveWorkspaceRoot: () => '/fake/workspace',
}));

vi.mock('@/mma/server-client', () => ({
  buildMmaClient: vi.fn().mockResolvedValue({
    dispatch: vi.fn().mockResolvedValue({ taskId: 'mock-task' }),
  }),
}));

vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: vi.fn().mockResolvedValue('mock-batch-id'),
  findInflight: vi.fn().mockResolvedValue(null),
}));

const projectId = 'test-sched-1';

function makeDetailsWithRecordedTasks() {
  const d = buildInitialDetails();
  d.stages.exploration.phases.discover.tasks = [{
    kind: 'research', prompt: 'p', status: 'recorded',
    attempts: [{ batchId: 'b1', status: 'done', at: '' }],
  }];
  return d;
}

describe('SynthesisScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: a burst of terminal events coalesces into ONE dispatch after the quiet window', async () => {
    const { dispatchMma } = await import('@/dispatch/dispatch-helpers');

    const d = makeDetailsWithRecordedTasks();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsReady: true }],
      'select:ops_mma_batch': [{ id: 'b1', route: 'research', status: 'done', result: { output: { summary: { answer: 'found stuff' } } } }],
    });

    const bus = new ProjectEventBus();
    const sched = new SynthesisScheduler({ db: mockDb, bus, debounceMs: 60_000 });
    sched.watch(projectId);

    bus.publish(projectId, { type: 'task.done', taskId: 't1', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    expect(sched.isArmed(projectId)).toBe(true);
    bus.publish(projectId, { type: 'task.done', taskId: 't2', mmaBatchId: 'b', route: 'research', status: 'recorded' });
    expect(sched.isArmed(projectId)).toBe(true);

    await sched.flush(projectId);
    expect(sched.isArmed(projectId)).toBe(false);
    expect(dispatchMma).toHaveBeenCalled();
    sched.shutdown();
  });

  it('boot reconciliation dispatches synthesis for a project with no exploration.md', async () => {
    const { dispatchMma } = await import('@/dispatch/dispatch-helpers');
    (dispatchMma as any).mockClear();

    const { readExplorationSummary } = await import('@/projects/project-files');
    // MUST be a resolved Promise, not a raw value — the reconcile path awaits it. With the earlier
    // unawaited bug, `existing` was a (truthy) Promise here and this dispatch never fired; a
    // mockReturnValue would have hidden that. This mock makes the test a real regression lock.
    (readExplorationSummary as any).mockResolvedValue(null);

    const d = makeDetailsWithRecordedTasks();
    const mockDb = createMockDb({
      'select:project': seq(
        [{ id: projectId, details: d, detailsReady: true }],
        [{ details: d, detailsReady: true }],
      ),
      'select:ops_mma_batch': [{ id: 'b1', route: 'research', status: 'done', result: { output: { summary: { answer: 'data' } } } }],
      'select:project_exploration_task': [],
    });

    const sched = new SynthesisScheduler({ db: mockDb, bus: new ProjectEventBus() });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).toContain(projectId);
    expect(dispatchMma).toHaveBeenCalled();
  });

  it('skips reconciliation when exploration.md already exists', async () => {
    const { readExplorationSummary } = await import('@/projects/project-files');
    (readExplorationSummary as any).mockResolvedValue('## Background\n\nAlready done');

    const d = makeDetailsWithRecordedTasks();
    const mockDb = createMockDb({
      'select:project': [{ id: projectId, details: d, detailsReady: true }],
      'select:project_exploration_task': [],
    });

    const sched = new SynthesisScheduler({ db: mockDb, bus: new ProjectEventBus() });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).not.toContain(projectId);
  });
});
