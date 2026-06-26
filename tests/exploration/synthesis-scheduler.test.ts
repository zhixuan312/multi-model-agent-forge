// @vitest-environment node
import { vi, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { SynthesisScheduler } from '@/exploration/synthesis-scheduler';
import { ProjectEventBus } from '@/sse/event-bus';
import { mockAnthropic } from './mock-anthropic';
import { createMockDb, seq } from '../test-utils/mock-db';
import { writeExplorationSummary } from '@/projects/project-files';

const synthOutput = { background: 'b', currentState: 'c', roughDirection: 'd' };
const projectId = 'test-sched-1';

function explorationFile(): string {
  return join(process.cwd(), '.forge-workspace', '.mma', 'projects', projectId, 'exploration.md');
}

function cleanup(): void {
  rmSync(join(process.cwd(), '.forge-workspace', '.mma', 'projects', projectId), { recursive: true, force: true });
}

describe('SynthesisScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('debounces: a burst of terminal events coalesces into ONE synthesis after the quiet window', async () => {
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
    expect(sched.isArmed(projectId)).toBe(true);

    await sched.flush(projectId);
    expect(sched.isArmed(projectId)).toBe(false);
    sched.shutdown();

    expect(existsSync(explorationFile())).toBe(true);
  });

  it('boot reconciliation synthesizes a project with no exploration.md', async () => {
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

    const sched = new SynthesisScheduler({
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    const swept = await sched.reconcileOnBoot();
    sched.shutdown();

    expect(swept).toContain(projectId);
    expect(existsSync(explorationFile())).toBe(true);
  });

  it('skips reconciliation when exploration.md already exists', async () => {
    writeExplorationSummary(projectId, '## Background\n\nAlready done');

    const mockDb = createMockDb({
      'select:project_exploration_task': [{ projectId, total: 1, recorded: 1 }],
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
