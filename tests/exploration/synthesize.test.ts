// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { synthesize } from '@/exploration/synthesize';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { mockAnthropic } from './mock-anthropic';
import { createMockDb } from '../test-utils/mock-db';

const synthOutput = {
  background: 'The work is about X.',
  currentState: 'Today the system does Y.',
  roughDirection: 'Move toward Z.',
};

function taskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskId: 'task-1',
    kind: 'investigate',
    prompt: 'p',
    route: 'investigate',
    batchStatus: 'done',
    result: { output: { summary: { answer: 'findings here' } }, error: null },
    repoName: null,
    ...overrides,
  };
}

function explorationFilePath(projectId: string): string {
  return join(process.cwd(), '.forge-workspace', '.mma', 'projects', projectId, 'exploration.md');
}

function cleanup(projectId: string): void {
  const dir = join(process.cwd(), '.forge-workspace', '.mma', 'projects', projectId);
  rmSync(dir, { recursive: true, force: true });
}

describe('synthesize', () => {
  const projectId = 'test-synth-1';

  afterEach(() => cleanup(projectId));

  it('writes exploration.md to disk with three sections + emits synthesis.updated', async () => {
    const mockDb = createMockDb({
      'select:project_exploration_task': [taskRow()],
    });

    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const res = await synthesize(projectId, { id: 'owner-1' }, {
      db: mockDb,
      bus,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });

    expect(res.ok).toBe(true);
    const filePath = explorationFilePath(projectId);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Background');
    expect(content).toContain('## Current state');
    expect(content).toContain('## Rough direction');
    expect(content).toContain('The work is about X.');
    expect(events.some((e) => e.type === 'synthesis.updated')).toBe(true);
  });

  it('a failed task yields an explicit gap marker in Current state', async () => {
    const repoName = 'api';
    const mockDb = createMockDb({
      'select:project_exploration_task': [
        taskRow(),
        taskRow({ taskId: 'task-2', batchStatus: 'failed', repoName, result: { error: { code: 'e', message: 'm' } } }),
      ],
    });

    const res = await synthesize(projectId, { id: 'owner-1' }, {
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });

    expect(res.ok).toBe(true);
    const content = readFileSync(explorationFilePath(projectId), 'utf-8');
    expect(content).toContain(`(investigate · repo \`${repoName}\`: failed — findings unavailable)`);
  });

  it('synthesis failure retains prior file + suppresses synthesis.updated', async () => {
    const mockDb = createMockDb({
      'select:project_exploration_task': [taskRow()],
    });

    const bus1 = new ProjectEventBus();
    await synthesize(projectId, { id: 'owner-1' }, {
      db: mockDb,
      bus: bus1,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    const firstContent = readFileSync(explorationFilePath(projectId), 'utf-8');

    const bus2 = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus2.subscribe(projectId, (e) => events.push(e));
    const res = await synthesize(projectId, { id: 'owner-1' }, {
      db: mockDb,
      bus: bus2,
      anthropic: mockAnthropic({ byCall: {}, throwOn: new Set(['synthesizeExploration']) }),
    });

    expect(res.ok).toBe(false);
    expect(events.some((e) => e.type === 'synthesis.updated')).toBe(false);
    expect(readFileSync(explorationFilePath(projectId), 'utf-8')).toBe(firstContent);
  });

  it('returns ok:false when no recorded tasks exist', async () => {
    const mockDb = createMockDb({
      'select:project_exploration_task': [],
    });

    const res = await synthesize(projectId, { id: 'owner-1' }, {
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res.ok).toBe(false);
  });
});
