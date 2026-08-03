// @vitest-environment node
import { vi } from 'vitest';
import { isDue, tickScheduler, STALE_RUN_MS } from '@/loops/scheduler';
import { createMockDb, seq } from '../test-utils/mock-db';

const at = (iso: string) => new Date(iso);

describe('isDue (cron interpreted in Asia/Singapore)', () => {
  const cron = '0 3 * * *'; // daily 03:00 SGT

  it('is due just after a scheduled time when never fired', () => {
    expect(isDue(cron, null, at('2026-06-15T03:00:30+08:00'))).toBe(true);
  });

  it('skips a missed occurrence (machine was off) — no back-fill', () => {
    expect(isDue(cron, null, at('2026-06-15T05:00:00+08:00'))).toBe(false);
  });

  it('does not re-fire an occurrence already fired', () => {
    expect(isDue(cron, at('2026-06-15T03:00:10+08:00'), at('2026-06-15T03:00:30+08:00'))).toBe(false);
  });

  it('false for an invalid cron', () => {
    expect(isDue('nope', null, at('2026-06-15T03:00:30+08:00'))).toBe(false);
  });
});

describe('tickScheduler', () => {
  it('fires only recurring loops and never auto-fires manual/event loops', async () => {
    const loopA = { id: 'A', mode: 'recurring', cron: '0 3 * * *', enabled: true };
    const loopB = { id: 'B', mode: 'manual', cron: null, enabled: true };
    const loopC = { id: 'C', mode: 'event', cron: '0 3 * * *', enabled: true };
    const db = createMockDb({
      'select:loop_def': [loopA, loopB, loopC],
      'select:loop_run': seq([], [], []),
    });
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'r' }));
    const res = await tickScheduler({ db, now: () => at('2026-06-15T03:00:30+08:00'), starter: starter as never });

    expect(res.fired).toEqual(['A']);
    expect(starter).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledWith('A', 'schedule', { db });
  });
});

/**
 * A `loop_run` row is written `running` before the work starts and only leaves that state
 * from inside the engine's own `finish()`. Kill the process mid-run — a restart, a deploy,
 * an OOM — and it stays `running` forever, and the in-flight check below skips that loop on
 * every subsequent tick. No error, no alert: a maintenance loop just stops firing, and its
 * history shows a run still going months later.
 *
 * `ops_mma_batch` has had this reaper for a while (`findInflight`'s `dispatch_orphaned`
 * path). Loop runs had none.
 */
describe('an abandoned run does not wedge its loop forever', () => {
  const CRON = '*/5 * * * *';
  const now = new Date('2026-07-01T04:00:00Z');
  const loopRow = { id: 'l1', enabled: true, mode: 'recurring', cron: CRON, teamId: 't1' };

  const dbWith = (startedAt: Date, status = 'running') =>
    createMockDb({
      'select:loop_def': [loopRow],
      'select:loop_run': [{ id: 'run-1', startedAt, status }],
      'update:loop_run': [{ id: 'run-1' }],
    });

  it('still skips a run that started recently', async () => {
    const db = dbWith(new Date(now.getTime() - 60_000));
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'r' }));
    const { fired } = await tickScheduler({ db: db as never, now: () => now, starter });

    expect(fired).toEqual([]);
    expect(db._wasCalled('loop_run', 'update'), 'a live run must not be failed').toBe(false);
    expect(starter).not.toHaveBeenCalled();
  });

  it('fails a run older than the threshold and lets the loop fire again', async () => {
    const db = dbWith(new Date(now.getTime() - STALE_RUN_MS - 1));
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'r' }));
    const { fired } = await tickScheduler({ db: db as never, now: () => now, starter });

    expect(db._wasCalled('loop_run', 'update'), 'the abandoned row should be failed').toBe(true);
    expect(fired).toEqual(['l1']);
  });

  it('honours an injected threshold', async () => {
    const db = dbWith(new Date(now.getTime() - 10_000));
    const starter = vi.fn(async () => ({ kind: 'started' as const, runId: 'r' }));
    const { fired } = await tickScheduler({ db: db as never, now: () => now, starter, staleRunMs: 5_000 });
    expect(fired).toEqual(['l1']);
  });
});
