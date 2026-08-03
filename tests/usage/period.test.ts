// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PERIODS, PERIOD_LABEL, DEFAULT_PERIOD, parsePeriod } from '@/usage/period';

/**
 * The accepted set was written out FIVE times — the `Period` union, a
 * `['week','month',…].includes(...)` whitelist in each of the four usage pages (every one
 * followed by an unchecked `as Period`), and the option list inside `PeriodSelect`.
 * Adding a period meant editing six places, and missing one page would silently reject
 * the new value and fall back to the default, with no error anywhere.
 */
describe('usage period', () => {
  it('accepts exactly the periods it offers', () => {
    for (const p of PERIODS) expect(parsePeriod(p)).toBe(p);
    expect(Object.keys(PERIOD_LABEL).sort()).toEqual([...PERIODS].sort());
  });

  it('falls back to the default for anything unrecognised', () => {
    for (const bad of ['', 'yesterday', 'MONTH', '31d', null, undefined]) {
      expect(parsePeriod(bad)).toBe(DEFAULT_PERIOD);
    }
  });

  it('has a default that is itself a valid period', () => {
    expect(PERIODS).toContain(DEFAULT_PERIOD);
  });

  it('labels every period non-trivially', () => {
    for (const p of PERIODS) expect(PERIOD_LABEL[p].trim().length).toBeGreaterThan(3);
  });
});
