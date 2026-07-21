import { describe, it, expect } from 'vitest';
import { formatDuration } from '@/components/forge/SummaryPhase';

describe('formatDuration', () => {
  it('renders sub-minute and sub-hour spans plainly', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(20 * 60_000)).toBe('20m');
  });

  it('floors the hour — 95 min is 1h 35m, not 2h 35m', () => {
    expect(formatDuration(95 * 60_000)).toBe('1h 35m');
    expect(formatDuration(119 * 60_000)).toBe('1h 59m');
    expect(formatDuration(120 * 60_000)).toBe('2h 0m');
    // a whole day of work stays coherent
    expect(formatDuration((16 * 60 + 50) * 60_000)).toBe('16h 50m');
  });
});
