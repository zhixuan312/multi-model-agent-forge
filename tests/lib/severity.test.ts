// @vitest-environment node
import { SEVERITY_ORDER, compareSeverity, isBlockingSeverity, normalizeSeverity } from '@/lib/severity';

/**
 * The one place free text becomes a tier. Three readers used to do this by hand and only
 * two of them lower-cased first, so `"Critical"` was a tier in the review page and not a
 * tier in the audit gate — see the `normalizeSeverity` docstring for what that cost.
 */
describe('normalizeSeverity', () => {
  it('recognises the canonical tiers', () => {
    for (const s of SEVERITY_ORDER) expect(normalizeSeverity(s)).toBe(s);
  });

  it('is case- and whitespace-insensitive — models title-case their own severity labels', () => {
    expect(normalizeSeverity('Critical')).toBe('critical');
    expect(normalizeSeverity('HIGH')).toBe('high');
    expect(normalizeSeverity('  Medium  ')).toBe('medium');
  });

  it('returns null — not a guessed tier — for anything outside the set', () => {
    // Null rather than a fallback: the fallback is the CALLER's decision and differs by
    // site (the audit parse keeps the finding as medium, the review chip renders low).
    // Baking one in here would have silently imposed it on the other.
    expect(normalizeSeverity('info')).toBeNull();
    expect(normalizeSeverity('urgent')).toBeNull();
    expect(normalizeSeverity('')).toBeNull();
    expect(normalizeSeverity('   ')).toBeNull();
  });
});

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

  it('ranks by TIER, not by case — `Critical` is not an unknown word', () => {
    // `explore-core` sorts raw envelope weights through this comparator. A case-sensitive
    // `indexOf` ranked `Critical` alongside typos, so the most severe evidence sorted to
    // the BOTTOM of the exploration output — the exact inversion this function prevents
    // for genuine typos, reintroduced by capitalisation alone.
    expect(['Low', 'CRITICAL', 'Medium', 'High'].sort(compareSeverity))
      .toEqual(['CRITICAL', 'High', 'Medium', 'Low']);
    expect(compareSeverity('Critical', 'low')).toBeLessThan(0);
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
