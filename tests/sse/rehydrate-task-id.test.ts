// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PollManager } from '@/sse/poll-manager';
import { ProjectEventBus } from '@/sse/event-bus';
import type { MmaClient } from '@/mma/client';
import { createMockDb } from '../test-utils/mock-db';

/**
 * A `taskByBatch` map sat in `rehydrate`, declared and NEVER populated, so every
 * rehydrated batch came back with `taskId: null`. A discover task in flight across a
 * server restart then never flipped to `recorded` and emitted no terminal event, leaving
 * the exploration fan-out waiting on it forever.
 *
 * The id is recovered from the persisted `request` — which is why the dispatcher now puts
 * it in `meta` as well as in the in-memory opts.
 */
describe('rehydrate recovers the owning discover task', () => {
  const row = (request: unknown) => ({
    id: 'row-1', batchId: 'mma-1', projectId: 'p1', route: 'investigate',
    handler: null, createdAt: new Date(), request,
  });

  /** A client whose poll resolves straight to a successful terminal envelope. */
  const terminalClient = () => ({
    poll: async () => ({ state: 'terminal' as const, envelope: { task: { status: 'completed' }, output: {}, error: null } }),
  }) as unknown as MmaClient;

  /** The project events a rehydrated batch emits when it reaches terminal. */
  async function eventsAfterTerminal(request: unknown): Promise<string[]> {
    const bus = new ProjectEventBus();
    const seen: string[] = [];
    const unsub = bus.subscribe('p1', (e) => { seen.push(e.type); });
    const pm = new PollManager({
      // The terminal transition CASes on an update returning a row (first writer wins);
      // without it `markTerminal` treats another poller as the winner and emits nothing.
      db: createMockDb({
        'select:ops_mma_batch': [row(request)],
        'update:ops_mma_batch': [{ id: 'row-1' }],
      }),
      bus,
      client: terminalClient(),
    });
    pm.disableTimers();
    await pm.rehydrate();
    await pm.pollOnce('row-1');
    pm.shutdown();
    unsub();
    return seen;
  }

  it('emits the discover task terminal when the request carries a taskId', async () => {
    // `task.done` is published ONLY for entries with a taskId — with the id lost, the
    // exploration fan-out never learns this task finished.
    expect(await eventsAfterTerminal({ taskId: 'task-7', taskKind: 'investigate' })).toContain('task.done');
  });

  it('emits none for a dispatch that owns no discover task', async () => {
    expect(await eventsAfterTerminal({ prompt: 'x' })).not.toContain('task.done');
  });
});
