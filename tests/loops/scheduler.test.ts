// @vitest-environment node
import { vi } from 'vitest';
import { isDue, tickScheduler } from '@/loops/scheduler';
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
