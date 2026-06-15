// @vitest-environment node
import { isValidCron, nextRuns, describeCron } from '@/loops/cron';

describe('describeCron', () => {
  it('humanizes common schedules', () => {
    expect(describeCron('0 0 * * *')).toBe('Daily at 00:00');
    expect(describeCron('0 3 * * *')).toBe('Daily at 03:00');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 * * * *')).toBe('Hourly');
    expect(describeCron('0 9 * * 1')).toBe('Mondays at 09:00');
    expect(describeCron('30 8 * * 1-5')).toBe('Weekdays at 08:30');
  });
  it('falls back to the raw expression for anything unusual', () => {
    expect(describeCron('5 4 1 * *')).toBe('5 4 1 * *');
    expect(describeCron('not a cron')).toBe('not a cron');
  });
});

describe('isValidCron', () => {
  it('accepts standard 5-field expressions', () => {
    expect(isValidCron('0 3 * * *')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0 6 * * 1')).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('99 99 * * *')).toBe(false);
  });
});

describe('nextRuns', () => {
  it('returns the next N future runs after a fixed point', () => {
    const from = new Date('2026-06-15T00:00:00.000Z');
    const runs = nextRuns('0 3 * * *', 3, from);
    expect(runs).toHaveLength(3);
    expect(runs.every((d) => d.getTime() > from.getTime())).toBe(true);
    // strictly increasing
    expect(runs[1].getTime()).toBeGreaterThan(runs[0].getTime());
    expect(runs[2].getTime()).toBeGreaterThan(runs[1].getTime());
  });
  it('returns [] for an invalid expression', () => {
    expect(nextRuns('nope', 3)).toEqual([]);
  });
});
