import { formatRelative } from '@/lib/format-relative';

const NOW = new Date('2026-06-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const S = 1000;
const MIN = 60 * S;
const HR = 60 * MIN;
const DAY = 24 * HR;

describe('formatRelative', () => {
  it('< 60s → "just now"', () => {
    expect(formatRelative(ago(5 * S), NOW)).toBe('just now');
  });
  it('< 60min → "N min ago"', () => {
    expect(formatRelative(ago(5 * MIN), NOW)).toBe('5 min ago');
  });
  it('< 24h → "N h ago"', () => {
    expect(formatRelative(ago(3 * HR), NOW)).toBe('3 h ago');
  });
  it('< 30d → "N d ago"', () => {
    expect(formatRelative(ago(4 * DAY), NOW)).toBe('4 d ago');
  });
  it('≥ 30d → absolute date "MMM D, YYYY"', () => {
    const old = new Date('2026-01-15T09:00:00Z');
    expect(formatRelative(old, NOW)).toBe('Jan 15, 2026');
  });
});
