import { describe, it, expect } from 'vitest';
import { periodCutoff } from '@/usage/usage-core';

describe('periodCutoff', () => {
  it('returns null for "all"', () => {
    expect(periodCutoff('all')).toBeNull();
  });

  it('"30d" returns 30 days before now', () => {
    const now = new Date('2026-06-19T10:00:00Z');
    const cutoff = periodCutoff('30d', now)!;
    const diff = now.getTime() - cutoff.getTime();
    expect(diff).toBe(30 * 86_400_000);
  });

  it('"90d" returns 90 days before now', () => {
    const now = new Date('2026-06-19T10:00:00Z');
    const cutoff = periodCutoff('90d', now)!;
    const diff = now.getTime() - cutoff.getTime();
    expect(diff).toBe(90 * 86_400_000);
  });

  it('"month" returns 1st of the month in SGT', () => {
    // June 19, 2026, 10:00 UTC = June 19 18:00 SGT
    const now = new Date('2026-06-19T10:00:00Z');
    const cutoff = periodCutoff('month', now)!;
    // Should be June 1 00:00 SGT = May 31 16:00 UTC
    expect(cutoff.toISOString()).toBe('2026-05-31T16:00:00.000Z');
  });

  it('"week" returns Monday 00:00 SGT', () => {
    // June 19, 2026 is a Friday
    const now = new Date('2026-06-19T10:00:00Z');
    const cutoff = periodCutoff('week', now)!;
    // Monday June 15 00:00 SGT = June 14 16:00 UTC
    expect(cutoff.toISOString()).toBe('2026-06-14T16:00:00.000Z');
  });
});
