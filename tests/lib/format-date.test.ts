import {
  formatRelative,
  formatDate,
  formatDateTime,
  formatTime,
  formatIsoDate,
  formatBranchTime,
  formatTimestamp,
} from '@/lib/format-date';

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

describe('formatDate', () => {
  it('renders a deterministic "MMM D, YYYY" string', () => {
    expect(formatDate(new Date('2026-06-09T12:00:00Z'))).toBe('Jun 9, 2026');
  });
  it('uses Asia/Singapore timezone (UTC+8)', () => {
    // 2026-12-31T23:30:00Z = 2027-01-01 07:30 SGT
    const instant = new Date('2026-12-31T23:30:00Z');
    expect(formatDate(instant)).toBe('Jan 1, 2027');
  });
});

/**
 * The five formatters below had NO test of any kind, while `format-date.ts` states that
 * "every date display in the product uses these functions". Two reasons that matters
 * more than the usual coverage argument:
 *
 * 1. **The timezone is a product invariant.** Forge is Asia/Singapore end to end. These
 *    feed a UTC instant and assert the SGT rendering, so a regression to machine-local
 *    time fails here instead of quietly shifting every timestamp in the UI by the CI
 *    runner's offset.
 *
 * 2. **`hour12: false` is environment-dependent.** Under some ICU builds it resolves to
 *    the h24 cycle and renders midnight as hour "24" — which would print "24:05" and, in
 *    the date formatters, pair that with the wrong day. Current Node resolves en-US to
 *    h23 and yields "00"; the midnight cases pin it rather than trusting the runtime.
 *
 * SGT is UTC+8 with no DST, so each expectation is the UTC instant plus 8 hours.
 */

// 2026-07-01 00:05 SGT — still the PREVIOUS day in UTC. The rollover + midnight case.
const MIDNIGHT_SGT = '2026-06-30T16:05:00Z';
// 2026-07-01 08:04 SGT — the example spelled out in the module's own docstrings.
const MORNING_SGT = '2026-07-01T00:04:00Z';
// 2026-07-01 23:59 SGT — the other end of the day.
const LATE_SGT = '2026-07-01T15:59:00Z';

describe('format-date — the shapes each formatter documents', () => {
  it('formatDateTime → "01 Jul 2026, 08:04"', () => {
    expect(formatDateTime(MORNING_SGT)).toBe('01 Jul 2026, 08:04');
  });
  it('formatTime → "08:04"', () => {
    expect(formatTime(MORNING_SGT)).toBe('08:04');
  });
  it('formatIsoDate → "2026-07-01"', () => {
    expect(formatIsoDate(MORNING_SGT)).toBe('2026-07-01');
  });
  it('formatTimestamp → "2026-07-01 08:04"', () => {
    expect(formatTimestamp(MORNING_SGT)).toBe('2026-07-01 08:04');
  });

  it('advances the DATE when the UTC instant is already tomorrow in SGT', () => {
    expect(formatIsoDate(MIDNIGHT_SGT)).toBe('2026-07-01');
    expect(formatTimestamp(MIDNIGHT_SGT)).toBe('2026-07-01 00:05');
  });

  it('renders SGT midnight as 00, never 24 (the h24 hour-cycle trap)', () => {
    expect(formatTime(MIDNIGHT_SGT)).toBe('00:05');
    expect(formatDateTime(MIDNIGHT_SGT)).toBe('01 Jul 2026, 00:05');
  });

  it('keeps the last minute of the SGT day on that day', () => {
    expect(formatTime(LATE_SGT)).toBe('23:59');
    expect(formatIsoDate(LATE_SGT)).toBe('2026-07-01');
  });

  it('treats Date, ISO string and epoch millis as the same instant', () => {
    const ms = Date.parse(MORNING_SGT);
    expect(formatTimestamp(new Date(ms))).toBe(formatTimestamp(MORNING_SGT));
    expect(formatTimestamp(ms)).toBe(formatTimestamp(MORNING_SGT));
  });
});

describe('format-date — invalid input degrades instead of throwing', () => {
  // The module documents "handle invalid input gracefully": echo the input back rather
  // than rendering "Invalid Date" or "NaN" into the UI.
  it('the display formatters echo an unparseable value back', () => {
    for (const fn of [formatDateTime, formatTime, formatIsoDate, formatTimestamp]) {
      expect(fn('not a date')).toBe('not a date');
    }
  });

  it('formatBranchTime returns a zero stamp instead, since it builds a git ref', () => {
    expect(formatBranchTime('not a date')).toBe('000000000');
  });
});

describe('formatBranchTime — HHMMSSmmm in SGT', () => {
  it('shifts to UTC+8 and keeps seconds + millis', () => {
    expect(formatBranchTime('2026-06-30T23:04:05.123Z')).toBe('070405123');
  });

  it('zero-pads to a fixed 9 characters', () => {
    const stamp = formatBranchTime('2026-06-30T16:00:00.007Z');
    expect(stamp).toBe('000000007');
    expect(stamp).toHaveLength(9);
  });

  it('distinguishes instants a millisecond apart — its whole purpose', () => {
    expect(formatBranchTime('2026-07-01T04:00:00.001Z')).not.toBe(
      formatBranchTime('2026-07-01T04:00:00.002Z'),
    );
  });
});

describe('formatRelative — exact bucket boundaries', () => {
  it('flips from "just now" to minutes exactly at 60s', () => {
    expect(formatRelative(ago(59 * S), NOW)).toBe('just now');
    expect(formatRelative(ago(60 * S), NOW)).toBe('1 min ago');
  });

  it('flips from minutes to hours exactly at 60min', () => {
    expect(formatRelative(ago(59 * MIN), NOW)).toBe('59 min ago');
    expect(formatRelative(ago(60 * MIN), NOW)).toBe('1 h ago');
  });

  it('flips from hours to days exactly at 24h', () => {
    expect(formatRelative(ago(23 * HR), NOW)).toBe('23 h ago');
    expect(formatRelative(ago(24 * HR), NOW)).toBe('1 d ago');
  });

  it('flips from days to an absolute date exactly at 30d', () => {
    expect(formatRelative(ago(29 * DAY), NOW)).toBe('29 d ago');
    expect(formatRelative(ago(30 * DAY), NOW)).toBe(formatDate(ago(30 * DAY)));
  });

  it('does not print a negative age for a clock-skewed future instant', () => {
    expect(formatRelative(new Date(NOW.getTime() + 5 * S), NOW)).toBe('just now');
  });
});
