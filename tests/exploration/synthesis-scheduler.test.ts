// @vitest-environment node
import { vi, afterEach } from 'vitest';
import { SynthesisScheduler } from '@/exploration/synthesis-scheduler';
import { ProjectEventBus } from '@/sse/event-bus';
import { createMockDb, seq } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn().mockReturnValue(null),
  readExplorationSummaryAsync: vi.fn().mockResolvedValue(null),
  readExplorationFileAsync: vi.fn().mockResolvedValue(null),
  writeExplorationSummaryAsync: vi.fn().mockResolvedValue('/fake/exploration.md'),
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
  dispatchAndRegister: vi.fn().mockResolvedValue('mock-batch-id'),
  findInflight: vi.fn().mockResolvedValue(null),
}));

const projectId = 'test-sched-1';

describe('SynthesisScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: a burst of terminal events coalesces into ONE dispatch after the quiet window', async () => {
    const { dispatchAndRegister } = await import('@/dispatch/dispatch-helpers');

    const mockDb = createMockDb({
      'select:project_exploration_task': [
        {
          taskId: 'task-1', kind: 'research', prompt: 'p', route: 'research',
          batchStatus: 'done',
          result: { output: { summary: { answer: 'found stuff' } }, error: null },
          repoName: null,
        },
      ],
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
    expect(dispatchAndRegister).toHaveBeenCalled();
    sched.shutdown();
  });

  it('boot reconciliation dispatches synthesis for a project with no exploration.md', async () => {
    const { dispatchAndRegister } = await import('@/dispatch/dispatch-helpers');
    (dispatchAndRegister as any).mockClear();

    const { readExplorationSummary } = await import('@/projects/project-files');
    (readExplorationSummary as any).mockReturnValue(null);

    const mockDb = createMockDb({
      'select:project_exploration_task': seq(
        [{ projectId, total: 1, recorded: 1 }],
        [
          {
            taskId: 'task-1', kind: 'research', prompt: 'p', route: 'research',
            batchStatus: 'done',
            result: { output: { summary: { answer: 'data' } }, error: null },
            repoName: null,
          },
        ],
      ),
    });

    const sched = new SynthesisScheduler({ db: mockDb, bus: new ProjectEventBus() });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).toContain(projectId);
    expect(dispatchAndRegister).toHaveBeenCalled();
  });

  it('skips reconciliation when exploration.md already exists', async () => {
    const { readExplorationSummary } = await import('@/projects/project-files');
    (readExplorationSummary as any).mockReturnValue('## Background\n\nAlready done');

    const mockDb = createMockDb({
      'select:project_exploration_task': [{ projectId, total: 1, recorded: 1 }],
    });

    const sched = new SynthesisScheduler({ db: mockDb, bus: new ProjectEventBus() });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).not.toContain(projectId);
  });
});
