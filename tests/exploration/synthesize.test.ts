// @vitest-environment node
import { and, eq, desc } from 'drizzle-orm';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { synthesize } from '@/exploration/synthesize';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { mockAnthropic } from './mock-anthropic';
import { createMockDb, seq } from '../test-utils/mock-db';

const synthOutput = {
  background: 'The work is about X.',
  currentState: 'Today the system does Y.',
  roughDirection: 'Move toward Z.',
};

describe('synthesize', () => {
  it('writes artifact(kind=exploration) v1 with the three sections + emits synthesis.updated', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const mockDb = createMockDb({
      'select:exploration_task': [
        {
          taskId: 'task-1',
          projectId,
          kind: 'investigate',
          prompt: 'p',
          route: 'investigate',
          batchStatus: 'done',
          result: { headline: 'ok', structuredReport: { summary: 's' } },
          repoName: null,
        },
      ],
      'select:artifact': [{ v: 0 }],
      'insert:artifact': [{ id: 'art-1' }],
    });

    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const res = await synthesize(projectId, { id: ownerId }, {
      db: mockDb,
      bus,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res).toMatchObject({ ok: true, version: 1 });
    const valuesCall = mockDb._callsFor('artifact').find((c) => c.method === 'values');
    expect(valuesCall?.args[0]).toMatchObject({
      bodyMd: expect.stringContaining('## Background'),
    });
    expect((valuesCall?.args[0] as { bodyMd: string }).bodyMd).toContain('## Current state');
    expect((valuesCall?.args[0] as { bodyMd: string }).bodyMd).toContain('## Rough direction');
    expect(events.some((e) => e.type === 'synthesis.updated')).toBe(true);
  });

  it('re-synthesis bumps version; latest is returned by (project,kind,version desc)', async () => {
    const projectId = 'proj-2';
    const ownerId = 'owner-2';
    const mockDb = createMockDb({
      'select:exploration_task': [
        {
          taskId: 'task-1',
          projectId,
          kind: 'research',
          prompt: 'p',
          route: 'research',
          batchStatus: 'done',
          result: { headline: 'ok', structuredReport: { summary: 's' } },
          repoName: null,
        },
      ],
      'select:artifact': seq([{ v: 0 }], [{ v: 1 }]),
      'insert:artifact': seq([{ id: 'art-1' }], [{ id: 'art-2' }]),
    });

    const deps = { db: mockDb, bus: new ProjectEventBus(), anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput, synthOutput] } }) };
    const r1 = await synthesize(projectId, { id: ownerId }, deps);
    const r2 = await synthesize(projectId, { id: ownerId }, deps);
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
  });

  it('a failed task yields an explicit gap marker in Current state naming its route + repo', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';
    const repoId = 'repo-1';
    const repoName = 'api';

    const mockDb = createMockDb({
      'select:exploration_task': [
        {
          taskId: 'task-1',
          projectId,
          kind: 'investigate',
          prompt: 'p',
          route: 'investigate',
          batchStatus: 'done',
          result: { headline: 'ok', structuredReport: { summary: 's' } },
          repoName: null,
        },
        {
          taskId: 'task-2',
          projectId,
          kind: 'investigate',
          prompt: 'p',
          route: 'investigate',
          batchStatus: 'failed',
          result: { headline: 'failed', error: { code: 'e', message: 'm' } },
          repoName,
        },
      ],
      'select:mma_batch': seq(
        [
          {
            id: 'batch-1',
            projectId,
            route: 'investigate',
            targetRepoId: null,
            cwd: '/work',
            batchId: 'mma-x',
            status: 'done',
            request: {},
            result: { headline: 'ok', structuredReport: { summary: 's' } },
            terminalAt: new Date(),
          },
          {
            id: 'batch-2',
            projectId,
            route: 'investigate',
            targetRepoId: repoId,
            cwd: '/work',
            batchId: 'mma-y',
            status: 'failed',
            request: {},
            result: { headline: 'failed', error: { code: 'e', message: 'm' } },
            terminalAt: new Date(),
          },
        ],
        [
          {
            id: 'batch-1',
            projectId,
            route: 'investigate',
            targetRepoId: null,
            cwd: '/work',
            batchId: 'mma-x',
            status: 'done',
            request: {},
            result: { headline: 'ok', structuredReport: { summary: 's' } },
            terminalAt: new Date(),
          },
          {
            id: 'batch-2',
            projectId,
            route: 'investigate',
            targetRepoId: repoId,
            cwd: '/work',
            batchId: 'mma-y',
            status: 'failed',
            request: {},
            result: { headline: 'failed', error: { code: 'e', message: 'm' } },
            terminalAt: new Date(),
          },
        ],
      ),
      'select:repo': [
        {
          id: repoId,
          name: repoName,
          pathOnDisk: '/work/api',
          defaultBranch: 'main',
          kind: 'service',
        },
      ],
      'select:artifact': [{ v: 0 }],
      'insert:artifact': [{ id: 'art-1' }],
    });

    const res = await synthesize(projectId, { id: ownerId }, {
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res.ok).toBe(true);
    const valuesCall = mockDb._callsFor('artifact').find((c) => c.method === 'values');
    expect((valuesCall?.args[0] as { bodyMd: string }).bodyMd).toContain(
      `(investigate · repo \`${repoName}\`: failed — findings unavailable)`,
    );
  });

  it('a synthesis call failure retains the prior version + suppresses synthesis.updated (F31)', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const mockDb = createMockDb({
      'select:exploration_task': seq(
        [
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
        [
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
      ),
      'select:mma_batch': seq(
        [
          {
            id: 'batch-1',
            projectId,
            route: 'research',
            targetRepoId: null,
            cwd: '/work',
            batchId: 'mma-x',
            status: 'done',
            request: {},
            result: { headline: 'ok', structuredReport: { summary: 's' } },
            terminalAt: new Date(),
          },
        ],
        [
          {
            id: 'batch-1',
            projectId,
            route: 'research',
            targetRepoId: null,
            cwd: '/work',
            batchId: 'mma-x',
            status: 'done',
            request: {},
            result: { headline: 'ok', structuredReport: { summary: 's' } },
            terminalAt: new Date(),
          },
        ],
      ),
      'select:artifact': seq([], [{ id: 'art-1', projectId, kind: 'exploration', version: 1, bodyMd: 'v1' }]),
      'insert:artifact': [{ id: 'art-1', projectId, kind: 'exploration', version: 1, bodyMd: 'v1' }],
    });

    const bus1 = new ProjectEventBus();
    await synthesize(projectId, { id: ownerId }, {
      db: mockDb,
      bus: bus1,
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });

    const bus2 = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus2.subscribe(projectId, (e) => events.push(e));
    const res = await synthesize(projectId, { id: ownerId }, {
      db: mockDb,
      bus: bus2,
      anthropic: mockAnthropic({ byCall: {}, throwOn: new Set(['synthesizeExploration']) }),
    });
    expect(res.ok).toBe(false);
    expect(events.some((e) => e.type === 'synthesis.updated')).toBe(false);
  });

  it('returns ok:false when no recorded tasks exist yet', async () => {
    const projectId = 'proj-5';
    const ownerId = 'owner-5';
    const mockDb = createMockDb({
      'select:exploration_task': [],
    });

    const res = await synthesize(projectId, { id: ownerId }, {
      db: mockDb,
      bus: new ProjectEventBus(),
      anthropic: mockAnthropic({ byCall: { synthesizeExploration: [synthOutput] } }),
    });
    expect(res.ok).toBe(false);
  });
});
