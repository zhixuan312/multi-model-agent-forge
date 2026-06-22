// @vitest-environment node
import { eq } from 'drizzle-orm';
import { mmaBatch } from '@/db/schema/mma';
import { explorationTask } from '@/db/schema/exploration';
import { MmaClient, type MmaClientConfig } from '@/mma/client';
import { PollManager, backoffMs, POLL_HARD_TIMEOUT_MS } from '@/sse/poll-manager';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { setPollLogSink, type PollLogRecord } from '@/observability/poll-log';
import { createMockDb, seq } from '../test-utils/mock-db';

const cfg: MmaClientConfig = { baseUrl: 'http://127.0.0.1:7337', token: 't', mainModel: 'm' };

function scriptedClient(script: (id: string) => Response): MmaClient {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const m = url.match(/\/batch\/([^/?]+)/);
    return script(m ? decodeURIComponent(m[1]) : '');
  }) as unknown as typeof fetch;
  return new MmaClient(cfg, { fetchImpl, client: 'claude-code' });
}

function pendingRes(headline: string): Response {
  return new Response(JSON.stringify({ status: 'running', phase: headline }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });
}
function terminalRes(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const doneEnvelope = {
  headline: 'done',
  results: [],
  error: { kind: 'not_applicable' },
  contextBlockId: 'cb-xyz',
};
const failedEnvelope = {
  headline: 'failed',
  results: [],
  error: { code: 'tool_error', message: 'boom' },
};

describe('PollManager', () => {
  it('backoffMs grows 2s·2^n capped at 30s with ±20% jitter', () => {
    expect(backoffMs(0, () => 0.5)).toBe(2000);
    expect(backoffMs(1, () => 0.5)).toBe(4000);
    expect(backoffMs(5, () => 0.5)).toBe(30000);
    expect(backoffMs(0, () => 0)).toBe(1600);
    expect(backoffMs(0, () => 1)).toBe(2400);
  });

  it('202 headline → status=running + task.progress emitted', async () => {
    const projectId = 'proj-1';
    const mmaBatchId = 'batch-1';
    const taskId = 'task-1';

    const mockDb = createMockDb({
      'select:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'dispatched', createdAt: new Date() }],
      'update:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'running', createdAt: new Date() }],
    });

    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => pendingRes('reading files…')), bus, db: mockDb });
    pm.disableTimers();
    pm.register({ batchId: mmaBatchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });

    const out = await pm.pollOnce(mmaBatchId);
    expect(out.kind).toBe('pending');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'task.progress', headline: 'reading files…', status: 'running' });
    expect(pm.isRegistered(mmaBatchId)).toBe(true);
    pm.shutdown();
  });

  it('200 terminal (done) → result+cbId persisted, task recorded, task.done emitted, deregistered', async () => {
    const projectId = 'proj-2';
    const mmaBatchId = 'batch-2';
    const taskId = 'task-2';

    const mockDb = createMockDb({
      'select:ops_mma_batch': seq(
        [{ id: mmaBatchId, projectId, status: 'dispatched', createdAt: new Date() }],
        [{ id: mmaBatchId, projectId, status: 'done', result: doneEnvelope, terminalAt: new Date(), createdAt: new Date() }],
      ),
      'update:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'done', result: doneEnvelope, terminalAt: new Date() }],
      'update:project_exploration_task': [{ id: taskId, status: 'recorded' }],
    });

    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => terminalRes(doneEnvelope)), bus, db: mockDb });
    pm.disableTimers();
    pm.register({ batchId: mmaBatchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });

    const out = await pm.pollOnce(mmaBatchId);
    expect(out.kind).toBe('terminal');
    expect(events.some((e) => e.type === 'task.done')).toBe(true);
    expect(pm.isRegistered(mmaBatchId)).toBe(false);
  });

  it('terminal failed envelope → status=failed, task.failed emitted, task still recorded', async () => {
    const projectId = 'proj-3';
    const mmaBatchId = 'batch-3';
    const taskId = 'task-3';

    const mockDb = createMockDb({
      'select:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'dispatched', createdAt: new Date() }],
      'update:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'failed', result: failedEnvelope, terminalAt: new Date() }],
      'update:project_exploration_task': [{ id: taskId, status: 'recorded' }],
    });

    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => terminalRes(failedEnvelope)), bus, db: mockDb });
    pm.disableTimers();
    pm.register({ batchId: mmaBatchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });
    await pm.pollOnce(mmaBatchId);

    const failed = events.find((e) => e.type === 'task.failed');
    expect(failed).toMatchObject({ type: 'task.failed', error: { code: 'tool_error', message: 'boom' } });
  });

  it('transient poll error → backoff retry, NOT marked failed; logs poll.retry', async () => {
    const projectId = 'proj-4';
    const mmaBatchId = 'batch-4';
    const taskId = 'task-4';
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));

    const mockDb = createMockDb({
      'select:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'dispatched', createdAt: new Date() }],
    });

    const failingClient = scriptedClient(() => {
      throw new Error('ECONNREFUSED');
    });
    const pm = new PollManager({ client: failingClient, bus: new ProjectEventBus(), db: mockDb, rand: () => 0.5 });
    pm.disableTimers();
    pm.register({ batchId: mmaBatchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });

    const out = await pm.pollOnce(mmaBatchId);
    restore();

    expect(out).toMatchObject({ kind: 'transient', attempt: 0, backoffMs: 2000 });
    expect(logs.some((l) => l.event === 'poll.retry' && l.attempt === 0 && l.backoffMs === 2000)).toBe(true);
    expect(logs.some((l) => l.event === 'mma.call_error')).toBe(true);
    pm.shutdown();
  });

  it('hard timeout (>15min) → force failed forge_poll_timeout, task.failed, deregistered (F1)', async () => {
    const projectId = 'proj-5';
    const mmaBatchId = 'batch-5';
    const taskId = 'task-5';
    const past = new Date(Date.now() - (POLL_HARD_TIMEOUT_MS + 60_000));
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));

    const mockDb = createMockDb({
      'select:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'dispatched', createdAt: past }],
      'update:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'failed', result: { error: { code: 'forge_poll_timeout' } }, terminalAt: new Date() }],
      'update:project_exploration_task': [{ id: taskId, status: 'recorded' }],
    });

    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => terminalRes(doneEnvelope)), bus, db: mockDb });
    pm.disableTimers();
    pm.register({ batchId: mmaBatchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: past });

    const out = await pm.pollOnce(mmaBatchId);
    restore();
    expect(out.kind).toBe('timeout');
    const failed = events.find((e) => e.type === 'task.failed');
    expect(failed).toMatchObject({ error: { code: 'forge_poll_timeout' } });
    expect(logs.some((l) => l.event === 'poll.timeout')).toBe(true);
    expect(pm.isRegistered(mmaBatchId)).toBe(false);
  });

  it('rehydrate re-registers in-flight batches; a past-deadline one fails on first poll', async () => {
    const projectId = 'proj-6';
    const freshBatchId = 'batch-6';
    const staleBatchId = 'batch-7';
    const past = new Date(Date.now() - (POLL_HARD_TIMEOUT_MS + 60_000));

    const mockDb = createMockDb({
      'select:ops_mma_batch': seq(
        [
          { id: freshBatchId, batchId: 'mma-fresh', projectId, route: 'research', status: 'running', createdAt: new Date() },
          { id: staleBatchId, batchId: 'mma-stale', projectId, route: 'research', status: 'dispatched', createdAt: past },
        ],
        [{ id: staleBatchId, batchId: 'mma-stale', projectId, route: 'research', status: 'dispatched', createdAt: past }],
      ),
      'select:project_exploration_task': [
        { id: 'task-fresh', mmaBatchId: freshBatchId },
        { id: 'task-stale', mmaBatchId: staleBatchId },
      ],
      'update:ops_mma_batch': [{ id: staleBatchId, projectId, status: 'failed' }],
      'update:project_exploration_task': [{ id: 'task-x', status: 'recorded' }],
    });

    const pm = new PollManager({ client: scriptedClient(() => pendingRes('still going')), bus: new ProjectEventBus(), db: mockDb });
    pm.disableTimers();
    const n = await pm.rehydrate();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(pm.isRegistered(freshBatchId)).toBe(true);
    expect(pm.isRegistered(staleBatchId)).toBe(true);

    const out = await pm.pollOnce(staleBatchId);
    expect(out.kind).toBe('timeout');
    pm.shutdown();
  });

  it('emits a structured log for each terminal done (observability F7)', async () => {
    const projectId = 'proj-7';
    const mmaBatchId = 'batch-8';
    const taskId = 'task-8';
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));

    const mockDb = createMockDb({
      'select:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'dispatched', createdAt: new Date() }],
      'update:ops_mma_batch': [{ id: mmaBatchId, projectId, status: 'done', result: doneEnvelope, terminalAt: new Date() }],
      'update:project_exploration_task': [{ id: taskId, status: 'recorded' }],
    });

    const pm = new PollManager({ client: scriptedClient(() => terminalRes(doneEnvelope)), bus: new ProjectEventBus(), db: mockDb });
    pm.disableTimers();
    pm.register({ batchId: mmaBatchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });
    await pm.pollOnce(mmaBatchId);
    restore();
    expect(logs.some((l) => l.event === 'task.done')).toBe(true);
  });
});
