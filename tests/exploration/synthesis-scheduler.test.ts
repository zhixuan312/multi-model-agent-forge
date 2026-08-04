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
  // Calls accumulate across cases on a module-level mock, so every case starts from zero —
  // otherwise `toHaveBeenCalled()` can be satisfied by the PREVIOUS test's dispatch.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The debounce case installs a fake clock; every other case needs the real one back.
  afterEach(() => {
    vi.useRealTimers();
  });

  function armedScheduler(bus: ProjectEventBus, debounceMs: number) {
    const d = makeDetailsWithRecordedTasks();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsReady: true }],
      'select:ops_mma_batch': [{ id: 'b1', route: 'research', status: 'done', result: { output: { summary: { answer: 'found stuff' } } } }],
    });
    const sched = new SynthesisScheduler({ db: mockDb, bus, debounceMs });
    sched.watch(projectId);
    return sched;
  }

  const terminal = (taskId: string) =>
    ({ type: 'task.done', taskId, mmaBatchId: 'b', route: 'research', status: 'recorded' }) as const;

  /**
   * Drives the REAL timer, on a fake clock, rather than calling `flush()`.
   *
   * That distinction is the whole test. An earlier version published its events and then
   * called `flush()` — which cancels the pending timer and synthesizes immediately — so the
   * debounce never ran. Deleting the `clearTimeout` from `bump`, i.e. deleting coalescing
   * itself, left every case green: each event's orphaned timer was simply never reached.
   * The case named the property it did not exercise.
   *
   * Advancing the clock past the window is what makes the second event's timer SUPERSEDE
   * the first's observable, so "two events, one synthesis" is now a claim about the
   * scheduler rather than about `flush()`.
   */
  it('debounces: a burst of terminal events coalesces into ONE dispatch after the quiet window', async () => {
    vi.useFakeTimers();
    const { dispatchMma } = await import('@/dispatch/dispatch-helpers');

    const bus = new ProjectEventBus();
    const sched = armedScheduler(bus, 5_000);

    bus.publish(projectId, terminal('t1'));
    expect(sched.isArmed(projectId)).toBe(true);

    // A second event 1s in RESTARTS the window — the first event's timer must not survive it.
    await vi.advanceTimersByTimeAsync(1_000);
    bus.publish(projectId, terminal('t2'));
    expect(sched.isArmed(projectId)).toBe(true);

    // t=5.5s: past the FIRST event's original deadline, short of the second's. A scheduler
    // that let each event keep its own timer has already dispatched here.
    await vi.advanceTimersByTimeAsync(4_500);
    expect(dispatchMma, 'the superseded timer must not fire').not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatchMma).toHaveBeenCalledTimes(1);
    expect(sched.isArmed(projectId)).toBe(false);
    sched.shutdown();
  });

  it('flush() is the cancel-and-run-now seam, and it runs synthesis exactly once', async () => {
    const { dispatchMma } = await import('@/dispatch/dispatch-helpers');
    const bus = new ProjectEventBus();
    const sched = armedScheduler(bus, 60_000);

    bus.publish(projectId, terminal('t1'));
    bus.publish(projectId, terminal('t2'));
    expect(dispatchMma).not.toHaveBeenCalled();

    await sched.flush(projectId);
    expect(sched.isArmed(projectId)).toBe(false);
    expect(dispatchMma).toHaveBeenCalledTimes(1);
    sched.shutdown();
  });

  it('boot reconciliation dispatches synthesis for a project with no exploration.md', async () => {
    const { dispatchMma } = await import('@/dispatch/dispatch-helpers');

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
