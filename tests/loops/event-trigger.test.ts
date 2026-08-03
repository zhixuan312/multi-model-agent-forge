// @vitest-environment node
import { vi } from 'vitest';
import { acceptLoopEvent } from '@/loops/event-trigger';
import { hashEventToken } from '@/loops/event-token';
import { createMockDb } from '../test-utils/mock-db';

const EVENT_TOKEN = 'event-token';

const loopRow = {
  id: 'loop-1',
  teamId: 'team-1',
  name: 'Incident loop',
  kind: 'maintenance',
  config: { goalMd: 'fallback' },
  workerTier: 'complex',
  mode: 'event',
  cron: null,
  targetBranch: null,
  repoIds: ['r1'],
  eventTokenHash: hashEventToken(EVENT_TOKEN),
  enabled: true,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('acceptLoopEvent', () => {
  it('accepts a first-seen delivery and starts exactly one run', async () => {
    const db = createMockDb({
      'select:loop_def': [loopRow],
      'insert:loop_event_delivery': [{ runId: 'run-1' }],
    });
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'run-1' }));
    const res = await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: 'Bearer event-token',
      idempotencyKey: 'evt-1',
      body: { goal: 'Investigate incident', reference: 'INC-1', context: 'Alarm fired' },
      deps: { db, starter, randomId: () => 'run-1' },
    });
    expect(res).toEqual({ kind: 'accepted', runId: 'run-1' });
    expect(starter).toHaveBeenCalledTimes(1);
  });

  it('returns the existing runId for duplicates without starting again', async () => {
    // A duplicate delivery must NEVER re-run — a code-changing agent must not double-execute
    // one incident. We always ack the existing runId and start nothing.
    const db = createMockDb({
      'select:loop_def': [loopRow],
      'insert:loop_event_delivery': [],
      'select:loop_event_delivery': [{ runId: 'run-existing' }],
    });
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'run-existing' }));
    const res = await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: 'Bearer event-token',
      idempotencyKey: 'evt-1',
      body: { goal: 'Investigate incident' },
      deps: { db, starter, randomId: () => 'run-new' },
    });
    expect(res).toEqual({ kind: 'accepted', runId: 'run-existing' });
    expect(starter).not.toHaveBeenCalled();
  });

  it('deletes the delivery row when dispatch throws so the key can be retried', async () => {
    const db = createMockDb({
      'select:loop_def': [loopRow],
      'insert:loop_event_delivery': [{ runId: 'run-1' }],
    });
    const starter = vi.fn(async () => { throw new Error('dispatch failed'); });
    const res = await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: 'Bearer event-token',
      idempotencyKey: 'evt-1',
      body: { goal: 'Investigate incident' },
      deps: { db, starter, randomId: () => 'run-1' },
    });
    expect(res.kind).toBe('internal_error');
    expect(db._wasCalled('loop_event_delivery', 'delete')).toBe(true);
  });

  /**
   * `enabled` is the pause switch and the SCHEDULER honours it
   * (`where(eq(loop.enabled, true))`). This path did not, so an event loop fired on every
   * delivery whatever the flag said — and the form only offered the Status control for
   * `recurring`, so there was no way to set it either. A misbehaving event loop could only
   * be stopped by deleting it or rotating its token.
   */
  it('refuses a paused loop, and starts nothing', async () => {
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'r1' }));
    const db = createMockDb({
      'select:loop_def': [{ ...loopRow, enabled: false }],
      'insert:loop_event_delivery': [{ runId: 'r1' }],
    });

    const res = await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: `Bearer ${EVENT_TOKEN}`,
      idempotencyKey: 'k1',
      body: { goal: 'Investigate incident' },
      deps: { db, starter },
    });

    expect(res.kind).toBe('disabled');
    expect(starter, 'a paused loop must not run').not.toHaveBeenCalled();
    // and it must not burn the idempotency key either — re-enabling and redelivering works
    expect(db._wasCalled('loop_event_delivery', 'insert')).toBe(false);
  });

  it('rejects wrong mode, bad token, bad body, and unknown loops', async () => {
    const badModeDb = createMockDb({ 'select:loop_def': [{ ...loopRow, mode: 'manual', eventTokenHash: null }] });
    expect((await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: 'Bearer event-token',
      idempotencyKey: 'evt-1',
      body: { goal: 'Investigate incident' },
      deps: { db: badModeDb },
    })).kind).toBe('wrong_mode');

    const badTokenDb = createMockDb({ 'select:loop_def': [loopRow] });
    expect((await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: 'Bearer wrong-token',
      idempotencyKey: 'evt-1',
      body: { goal: 'Investigate incident' },
      deps: { db: badTokenDb },
    })).kind).toBe('unauthorized');

    const invalidBodyDb = createMockDb({ 'select:loop_def': [loopRow] });
    expect((await acceptLoopEvent({
      loopId: 'loop-1',
      authorization: 'Bearer event-token',
      idempotencyKey: '',
      body: { goal: '   ' },
      deps: { db: invalidBodyDb },
    })).kind).toBe('invalid_request');

    const missingDb = createMockDb({ 'select:loop_def': [] });
    expect((await acceptLoopEvent({
      loopId: 'missing',
      authorization: 'Bearer event-token',
      idempotencyKey: 'evt-1',
      body: { goal: 'Investigate incident' },
      deps: { db: missingDb },
    })).kind).toBe('not_found');
  });
});
