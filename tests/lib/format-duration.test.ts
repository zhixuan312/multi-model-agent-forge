// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatElapsed, formatActivityDuration, formatDurationHm } from '@/lib/format-duration';
import { formatDuration as formatUsageDuration } from '@/usage/format';

/**
 * These three lived inline in components, which produced verbatim copies: `formatDur`
 * was character-for-character identical in `SummaryPhase` and `AutomationOverlay`, and
 * `formatElapsed` existed twice more, identical but for local variable names. Only the
 * `SummaryPhase` copy had any test; the others could have drifted with nothing failing.
 *
 * The last block is the point of the consolidation: it pins that the four duration
 * formatters are DIFFERENT on purpose, so a future "they all look the same, let's merge
 * them" change fails here instead of silently changing what four surfaces display.
 */
describe('formatElapsed — live counter, whole seconds', () => {
  it('floors to whole seconds so a ticking display never shows a fraction', () => {
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(1_999)).toBe('1s');
    expect(formatElapsed(45_000)).toBe('45s');
  });

  it('never rounds UP into a second that has not elapsed', () => {
    expect(formatElapsed(59_999)).toBe('59s');
  });

  it('switches to m+s at exactly one minute', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s');
    expect(formatElapsed(123_000)).toBe('2m 3s');
    expect(formatElapsed(3_600_000)).toBe('60m 0s');
  });
});

describe('formatActivityDuration — one finished activity, tenths', () => {
  it('keeps a tenth below a second, so fast activities are distinguishable', () => {
    expect(formatActivityDuration(400)).toBe('0.4s');
    expect(formatActivityDuration(0)).toBe('0s');
  });

  it('clamps a negative (clock-skewed) input to 0s rather than "-0.1s"', () => {
    expect(formatActivityDuration(-100)).toBe('0s');
  });

  it('keeps one decimal between 1s and a minute', () => {
    expect(formatActivityDuration(12_600)).toBe('12.6s');
    expect(formatActivityDuration(59_400)).toBe('59.4s');
  });

  it('switches to m+s at a minute', () => {
    expect(formatActivityDuration(123_000)).toBe('2m 3s');
    expect(formatActivityDuration(168_000)).toBe('2m 48s');
  });
});

describe('formatDurationHm — whole stage or project', () => {
  it('renders sub-minute and sub-hour spans plainly', () => {
    expect(formatDurationHm(500)).toBe('500ms');
    expect(formatDurationHm(45_000)).toBe('45s');
    expect(formatDurationHm(20 * 60_000)).toBe('20m');
  });

  it('floors the hour — 95 min is 1h 35m, not 2h 35m', () => {
    expect(formatDurationHm(95 * 60_000)).toBe('1h 35m');
    expect(formatDurationHm(119 * 60_000)).toBe('1h 59m');
    expect(formatDurationHm(120 * 60_000)).toBe('2h 0m');
    // a whole day of work stays coherent
    expect(formatDurationHm((16 * 60 + 50) * 60_000)).toBe('16h 50m');
  });
});

describe('the four formatters are deliberately different, not redundant', () => {
  const NINETY_FIVE_MIN = 95 * 60_000;

  it('render the same 95-minute span four distinct ways', () => {
    expect(formatDurationHm(NINETY_FIVE_MIN)).toBe('1h 35m'); // stage total
    expect(formatUsageDuration(NINETY_FIVE_MIN)).toBe('1.6h'); // dense usage table
    expect(formatElapsed(NINETY_FIVE_MIN)).toBe('95m 0s'); // live counter
    expect(formatActivityDuration(NINETY_FIVE_MIN)).toBe('95m 0s'); // activity row
  });

  it('differ on a sub-second span too', () => {
    expect(formatElapsed(400)).toBe('0s'); // a counter has not ticked yet
    expect(formatActivityDuration(400)).toBe('0.4s'); // the row shows real precision
    expect(formatDurationHm(400)).toBe('400ms'); // a total shows the raw ms
  });

  it('only the usage variant accepts null — the others take a number', () => {
    expect(formatUsageDuration(null)).toBe('—');
  });
});
