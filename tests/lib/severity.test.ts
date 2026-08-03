// @vitest-environment node
import { SEVERITY_ORDER, compareSeverity, isBlockingSeverity } from '@/lib/severity';

/**
 * `severity` is typed at the component boundary but originates as a free-text `weight` on
 * the engine envelope, so a word outside the set is a real input, not a hypothetical.
 */
describe('compareSeverity', () => {
  it('orders the known severities most-severe first', () => {
    const shuffled = ['low', 'critical', 'medium', 'high'];
    expect([...shuffled].sort(compareSeverity)).toEqual([...SEVERITY_ORDER]);
  });

  it('sorts an unrecognised severity LAST, never first', () => {
    // A raw `SEVERITY_ORDER.indexOf()` returns -1 here, which sorts the unknown value above
    // `critical` — letting a typo dominate the list. That is what this function exists for.
    expect(['weird', 'critical', 'low'].sort(compareSeverity)).toEqual(['critical', 'low', 'weird']);
    expect(compareSeverity('weird', 'low')).toBeGreaterThan(0);
  });

  it('is stable between two unrecognised values rather than reordering them', () => {
    expect(compareSeverity('aaa', 'zzz')).toBe(0);
  });
});

describe('isBlockingSeverity', () => {
  it('blocks on critical and high only', () => {
    expect(isBlockingSeverity('critical')).toBe(true);
    expect(isBlockingSeverity('high')).toBe(true);
    expect(isBlockingSeverity('medium')).toBe(false);
    expect(isBlockingSeverity('low')).toBe(false);
  });

  it('is case-insensitive — the engine weight is free text, not a typed column', () => {
    expect(isBlockingSeverity('CRITICAL')).toBe(true);
    expect(isBlockingSeverity('High')).toBe(true);
  });

  it('treats an unknown severity as non-blocking, so a typo cannot fail a clean pass', () => {
    expect(isBlockingSeverity('urgent')).toBe(false);
    expect(isBlockingSeverity('')).toBe(false);
  });
});
