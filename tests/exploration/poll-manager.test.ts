// @vitest-environment node
import { afterEach, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { explorationTask } from '@/db/schema/exploration';
import { MmaClient, type MmaClientConfig } from '@/mma/client';
import { PollManager, backoffMs, POLL_HARD_TIMEOUT_MS } from '@/sse/poll-manager';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { setPollLogSink, type PollLogRecord } from '@/observability/poll-log';
import { seedProject, seedMember, cleanupExploreFixtures } from './db-fixtures';

const cfg: MmaClientConfig = { baseUrl: 'http://127.0.0.1:7337', token: 't', mainModel: 'm' };

/** Build an MmaClient whose `GET /batch/:id` returns scripted responses by id. */
function scriptedClient(script: (id: string) => Response): MmaClient {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const m = url.match(/\/batch\/([^/?]+)/);
    return script(m ? decodeURIComponent(m[1]) : '');
  }) as unknown as typeof fetch;
  return new MmaClient(cfg, { fetchImpl, client: 'claude-code' });
}

function pendingRes(headline: string): Response {
  return new Response(headline, { status: 202, headers: { 'content-type': 'text/plain' } });
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

/** Seed an mma_batch + linked exploration_task; return their ids. */
async function seedBatch(opts: {
  projectId: string;
  ownerId: string;
  route?: 'investigate' | 'research' | 'journal_recall';
  status?: 'dispatched' | 'running';
  createdAt?: Date;
}): Promise<{ batchId: string; mmaBatchId: string; taskId: string }> {
  const db = getDb();
  const [b] = await db
    .insert(mmaBatch)
    .values({
      projectId: opts.projectId,
      route: opts.route ?? 'investigate',
      cwd: '/work/repo',
      batchId: `mma-${Math.random().toString(36).slice(2, 8)}`,
      status: opts.status ?? 'dispatched',
      request: { question: 'x' },
      dispatchedBy: opts.ownerId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: mmaBatch.id, batchId: mmaBatch.batchId, createdAt: mmaBatch.createdAt });
  const [t] = await db
    .insert(explorationTask)
    .values({
      projectId: opts.projectId,
      kind: 'investigate',
      prompt: 'x',
      status: 'running',
      mmaBatchId: b.id,
      createdBy: opts.ownerId,
    })
    .returning({ id: explorationTask.id });
  return { batchId: b.id, mmaBatchId: b.batchId!, taskId: t.id };
}

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('PollManager', () => {
  afterEach(async () => {
    await cleanupExploreFixtures();
  });

  it('backoffMs grows 2s·2^n capped at 30s with ±20% jitter', () => {
    expect(backoffMs(0, () => 0.5)).toBe(2000);
    expect(backoffMs(1, () => 0.5)).toBe(4000);
    expect(backoffMs(5, () => 0.5)).toBe(30000); // capped
    expect(backoffMs(0, () => 0)).toBe(1600); // -20%
    expect(backoffMs(0, () => 1)).toBe(2400); // +20%
  });

  it('202 headline → status=running + task.progress emitted', async () => {
    const { projectId, ownerId } = await seedProject();
    const { batchId, mmaBatchId, taskId } = await seedBatch({ projectId, ownerId });
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => pendingRes('reading files…')), bus });
    pm.disableTimers();
    pm.register({ batchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });

    const out = await pm.pollOnce(batchId);
    expect(out.kind).toBe('pending');

    const [row] = await getDb().select({ status: mmaBatch.status }).from(mmaBatch).where(eq(mmaBatch.id, batchId));
    expect(row.status).toBe('running');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'task.progress', headline: 'reading files…', status: 'running' });
    expect(pm.isRegistered(batchId)).toBe(true); // still in-flight
    pm.shutdown();
  });

  it('200 terminal (done) → result+cbId persisted, task recorded, task.done emitted, deregistered', async () => {
    const { projectId, ownerId } = await seedProject();
    const { batchId, mmaBatchId, taskId } = await seedBatch({ projectId, ownerId });
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => terminalRes(doneEnvelope)), bus });
    pm.disableTimers();
    pm.register({ batchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });

    const out = await pm.pollOnce(batchId);
    expect(out.kind).toBe('terminal');

    const db = getDb();
    const [b] = await db
      .select({ status: mmaBatch.status, result: mmaBatch.result, terminalAt: mmaBatch.terminalAt })
      .from(mmaBatch)
      .where(eq(mmaBatch.id, batchId));
    expect(b.status).toBe('done');
    expect((b.result as { contextBlockId?: string }).contextBlockId).toBe('cb-xyz');
    expect(b.terminalAt).not.toBeNull();

    const [t] = await db.select({ status: explorationTask.status }).from(explorationTask).where(eq(explorationTask.id, taskId));
    expect(t.status).toBe('recorded');

    expect(events.some((e) => e.type === 'task.done')).toBe(true);
    expect(pm.isRegistered(batchId)).toBe(false); // deregistered
  });

  it('terminal failed envelope → status=failed, task.failed emitted, task still recorded', async () => {
    const { projectId, ownerId } = await seedProject();
    const { batchId, mmaBatchId, taskId } = await seedBatch({ projectId, ownerId });
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));

    const pm = new PollManager({ client: scriptedClient(() => terminalRes(failedEnvelope)), bus });
    pm.disableTimers();
    pm.register({ batchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });
    await pm.pollOnce(batchId);

    const db = getDb();
    const [b] = await db.select({ status: mmaBatch.status }).from(mmaBatch).where(eq(mmaBatch.id, batchId));
    expect(b.status).toBe('failed'); // per-task failure derived from THIS, not the task row
    const [t] = await db.select({ status: explorationTask.status }).from(explorationTask).where(eq(explorationTask.id, taskId));
    expect(t.status).toBe('recorded');
    const failed = events.find((e) => e.type === 'task.failed');
    expect(failed).toMatchObject({ type: 'task.failed', error: { code: 'tool_error', message: 'boom' } });
  });

  it('transient poll error → backoff retry, NOT marked failed; logs poll.retry', async () => {
    const { projectId, ownerId } = await seedProject();
    const { batchId, mmaBatchId, taskId } = await seedBatch({ projectId, ownerId });
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));

    const failingClient = scriptedClient(() => {
      throw new Error('ECONNREFUSED');
    });
    const pm = new PollManager({ client: failingClient, bus: new ProjectEventBus(), rand: () => 0.5 });
    pm.disableTimers();
    pm.register({ batchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });

    const out = await pm.pollOnce(batchId);
    restore();

    expect(out).toMatchObject({ kind: 'transient', attempt: 0, backoffMs: 2000 });
    const [b] = await getDb().select({ status: mmaBatch.status }).from(mmaBatch).where(eq(mmaBatch.id, batchId));
    expect(b.status).not.toBe('failed'); // transient never fails
    expect(logs.some((l) => l.event === 'poll.retry' && l.attempt === 0 && l.backoffMs === 2000)).toBe(true);
    expect(logs.some((l) => l.event === 'mma.call_error')).toBe(true);
    pm.shutdown();
  });

  it('hard timeout (>15min) → force failed forge_poll_timeout, task.failed, deregistered (F1)', async () => {
    const { projectId, ownerId } = await seedProject();
    const past = new Date(Date.now() - (POLL_HARD_TIMEOUT_MS + 60_000));
    const { batchId, mmaBatchId, taskId } = await seedBatch({ projectId, ownerId, createdAt: past });
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe(projectId, (e) => events.push(e));
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));

    // The client should never even be polled — timeout precedes the poll.
    const pm = new PollManager({ client: scriptedClient(() => terminalRes(doneEnvelope)), bus });
    pm.disableTimers();
    pm.register({ batchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: past });

    const out = await pm.pollOnce(batchId);
    restore();
    expect(out.kind).toBe('timeout');

    const [b] = await getDb().select({ status: mmaBatch.status, result: mmaBatch.result }).from(mmaBatch).where(eq(mmaBatch.id, batchId));
    expect(b.status).toBe('failed');
    expect((b.result as { error?: { code?: string } }).error?.code).toBe('forge_poll_timeout');
    const failed = events.find((e) => e.type === 'task.failed');
    expect(failed).toMatchObject({ error: { code: 'forge_poll_timeout' } });
    expect(logs.some((l) => l.event === 'poll.timeout')).toBe(true);
    expect(pm.isRegistered(batchId)).toBe(false);
  });

  it('rehydrate re-registers in-flight batches; a past-deadline one fails on first poll', async () => {
    const { projectId, ownerId } = await seedProject();
    const fresh = await seedBatch({ projectId, ownerId, status: 'running' });
    const past = new Date(Date.now() - (POLL_HARD_TIMEOUT_MS + 60_000));
    const stale = await seedBatch({ projectId, ownerId, status: 'dispatched', createdAt: past });

    const pm = new PollManager({ client: scriptedClient(() => pendingRes('still going')), bus: new ProjectEventBus() });
    pm.disableTimers();
    const n = await pm.rehydrate();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(pm.isRegistered(fresh.batchId)).toBe(true);
    expect(pm.isRegistered(stale.batchId)).toBe(true);

    // Polling the stale one fails it immediately (timeout precedes poll).
    const out = await pm.pollOnce(stale.batchId);
    expect(out.kind).toBe('timeout');
    pm.shutdown();
  });

  it('emits a structured log for each terminal done (observability F7)', async () => {
    const { projectId, ownerId } = await seedProject();
    const { batchId, mmaBatchId, taskId } = await seedBatch({ projectId, ownerId });
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));
    const pm = new PollManager({ client: scriptedClient(() => terminalRes(doneEnvelope)), bus: new ProjectEventBus() });
    pm.disableTimers();
    pm.register({ batchId, mmaBatchId, projectId, route: 'investigate', taskId, createdAt: new Date() });
    await pm.pollOnce(batchId);
    restore();
    expect(logs.some((l) => l.event === 'task.done')).toBe(true);
  });
});

// keep seedMember reachable to fixtures consumers
void seedMember;
beforeEach(() => vi.restoreAllMocks());
