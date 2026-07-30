// @vitest-environment node
import { vi } from 'vitest';

const { recordActivity, resolveRunningActivity } = vi.hoisted(() => ({
  recordActivity: vi.fn(async () => {}),
  resolveRunningActivity: vi.fn(async () => 1),
}));
vi.mock('@/activity/project-activity', () => ({ recordActivity, resolveRunningActivity }));

import type { MmaClient } from '@/mma/client';
import { PollManager, CANCELLING_HEADLINE } from '@/sse/poll-manager';
import { ProjectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { setPollLogSink, type PollLogRecord } from '@/observability/poll-log';
import { createMockDb } from '../test-utils/mock-db';

/**
 * Cooperative cancellation (engine 5.16). Two halves, both covered here:
 *  - the REQUEST path (`requestCancel` → `DELETE /task/:id`), which is idempotent and
 *    only MARKS the batch — it never fabricates a terminal;
 *  - the TERMINAL path, which must persist `cancelled` (not `failed`), emit the
 *    cancelled events, and skip the success handler + failure notification.
 */

const cancelledEnvelope = {
  task: { taskId: 'mma-1', type: 'audit', status: 'cancelled' },
  output: { summary: null, filesChanged: [], contextBlockId: null },
  error: { code: 'aborted', message: 'Execution cancelled by caller' },
};

function stubClient(over: Partial<Record<'poll' | 'cancel', unknown>>): MmaClient {
  return {
    poll: async () => ({ state: 'pending', headline: 'implementing' }),
    cancel: async () => ({ state: 'requested' }),
    ...over,
  } as unknown as MmaClient;
}

function batchDb() {
  return createMockDb({
    'select:ops_mma_batch': [{
      id: 'row-1', projectId: 'proj-1', status: 'running',
      handler: null, request: {}, dispatchedBy: null, createdAt: new Date(),
    }],
    'update:ops_mma_batch': [{ id: 'row-1' }],
  });
}

describe('PollManager.requestCancel', () => {
  it('202 requested → marks the batch and reports `requested`', async () => {
    const cancel = vi.fn(async () => ({ state: 'requested' as const }));
    const pm = new PollManager({ db: batchDb(), bus: new ProjectEventBus(), client: stubClient({ cancel }) });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', createdAt: new Date() });

    expect(await pm.requestCancel('row-1')).toEqual({ kind: 'requested' });
    expect(cancel).toHaveBeenCalledWith('mma-1');
    expect(pm.isCancellationRequested('row-1')).toBe(true);
    // REQUESTED is not STOPPED — the batch stays tracked so the poll loop carries it
    // through to the terminal cancelled envelope.
    expect(pm.isRegistered('row-1')).toBe(true);
    pm.shutdown();
  });

  it('is idempotent — a repeat call is a no-op, never an error, and does not re-hit MMA', async () => {
    const cancel = vi.fn(async () => ({ state: 'requested' as const }));
    const pm = new PollManager({ db: batchDb(), bus: new ProjectEventBus(), client: stubClient({ cancel }) });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', createdAt: new Date() });

    await pm.requestCancel('row-1');
    expect(await pm.requestCancel('row-1')).toEqual({ kind: 'already_requested' });
    expect(await pm.requestCancel('row-1')).toEqual({ kind: 'already_requested' });
    expect(cancel).toHaveBeenCalledTimes(1);
    pm.shutdown();
  });

  it('200 alreadyTerminal → reports the real terminal state, does NOT mark a cancellation', async () => {
    const pm = new PollManager({
      db: batchDb(),
      bus: new ProjectEventBus(),
      client: stubClient({ cancel: async () => ({ state: 'already_terminal', status: 'completed' }) }),
    });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', createdAt: new Date() });

    expect(await pm.requestCancel('row-1')).toEqual({ kind: 'already_terminal', status: 'completed' });
    // Completion won the race — the batch must NOT be recorded as cancelled.
    expect(pm.isCancellationRequested('row-1')).toBe(false);
    pm.shutdown();
  });

  it('404 → not_tracked (a state, not a throw)', async () => {
    const pm = new PollManager({
      db: batchDb(),
      bus: new ProjectEventBus(),
      client: stubClient({ cancel: async () => ({ state: 'not_found' }) }),
    });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', createdAt: new Date() });

    expect(await pm.requestCancel('row-1')).toEqual({ kind: 'not_tracked' });
    pm.shutdown();
  });

  it('an unregistered batch is not_tracked, not an error', async () => {
    const pm = new PollManager({ db: batchDb(), bus: new ProjectEventBus(), client: stubClient({}) });
    pm.disableTimers();
    expect(await pm.requestCancel('never-registered')).toEqual({ kind: 'not_tracked' });
    pm.shutdown();
  });

  it('emits a "cancelling" progress event so the UI can show a stopping state', async () => {
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe('proj-1', (e) => events.push(e));
    const pm = new PollManager({ db: batchDb(), bus, client: stubClient({}) });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', handler: 'spec-audit', createdAt: new Date() });

    await pm.requestCancel('row-1');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task.progress', headline: CANCELLING_HEADLINE }),
      expect.objectContaining({ type: 'dispatch.progress', phase: CANCELLING_HEADLINE }),
    ]));
    pm.shutdown();
  });
});

describe('PollManager — cancellationRequested from the 202 poll body', () => {
  it('picks up a cancel requested elsewhere and surfaces it on the progress state', async () => {
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe('proj-1', (e) => events.push(e));
    const pm = new PollManager({
      db: batchDb(),
      bus,
      client: stubClient({
        poll: async () => ({ state: 'pending', headline: 'implementing', cancellationRequested: true }),
      }),
    });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', createdAt: new Date() });

    const out = await pm.pollOnce('row-1');
    expect(out).toMatchObject({ kind: 'pending', cancellationRequested: true });
    expect(pm.isCancellationRequested('row-1')).toBe(true);
    expect(events.some((e) => e.type === 'task.progress' && e.headline === CANCELLING_HEADLINE)).toBe(true);
    pm.shutdown();
  });
});

describe('PollManager — cancelled terminal', () => {
  it('persists status=cancelled (NOT failed) and emits task.cancelled + dispatch.cancelled', async () => {
    const db = batchDb();
    const bus = new ProjectEventBus();
    const events: ProjectEvent[] = [];
    bus.subscribe('proj-1', (e) => events.push(e));
    const pm = new PollManager({
      db,
      bus,
      client: stubClient({ poll: async () => ({ state: 'terminal', envelope: cancelledEnvelope }) }),
    });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: 'task-1', handler: 'spec-audit', createdAt: new Date() });

    const out = await pm.pollOnce('row-1');
    expect(out).toMatchObject({ kind: 'terminal', state: { status: 'cancelled' } });

    const setCall = db._callsFor('ops_mma_batch').find((c) => c.method === 'set');
    expect((setCall?.args[0] as { status?: string })?.status).toBe('cancelled');

    expect(events.some((e) => e.type === 'task.cancelled')).toBe(true);
    expect(events.some((e) => e.type === 'dispatch.cancelled')).toBe(true);
    // A cancel is NOT a failure — it must not masquerade as one.
    expect(events.some((e) => e.type === 'task.failed' || e.type === 'dispatch.failed')).toBe(false);
    expect(pm.isRegistered('row-1')).toBe(false);
  });

  it('does not run the success handler and logs task.cancelled', async () => {
    const logs: PollLogRecord[] = [];
    const restore = setPollLogSink((r) => logs.push(r));
    const db = createMockDb({
      // A handler IS set on the row: the success-handler lookup must still be skipped,
      // because it only runs for a `done` terminal.
      'select:ops_mma_batch': [{ id: 'row-1', projectId: 'proj-1', handler: 'spec-audit', request: {}, dispatchedBy: null, createdAt: new Date() }],
      'update:ops_mma_batch': [{ id: 'row-1' }],
    });
    const pm = new PollManager({
      db,
      bus: new ProjectEventBus(),
      client: stubClient({ poll: async () => ({ state: 'terminal', envelope: cancelledEnvelope }) }),
    });
    pm.disableTimers();
    pm.register({ batchId: 'row-1', mmaBatchId: 'mma-1', projectId: 'proj-1', route: 'audit', taskId: null, handler: 'spec-audit', createdAt: new Date() });

    await pm.pollOnce('row-1');
    restore();

    expect(logs.some((l) => l.event === 'task.cancelled')).toBe(true);
    expect(logs.some((l) => l.event === 'task.failed')).toBe(false);
    // The batch stayed `cancelled` — a thrown handler would have flipped it to `failed`.
    const statuses = db._callsFor('ops_mma_batch')
      .filter((c) => c.method === 'set')
      .map((c) => (c.args[0] as { status?: string })?.status);
    expect(statuses).toContain('cancelled');
    expect(statuses).not.toContain('failed');
  });
});
