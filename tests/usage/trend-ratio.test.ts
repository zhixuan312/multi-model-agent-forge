// @vitest-environment node
import { trendRatio } from '@/usage/usage-core';

describe('trendRatio — symmetric first/second-half spend (QA #3)', () => {
  it('flat spend is 1.0 regardless of series length (odd no longer biases up)', () => {
    expect(trendRatio([1, 1])).toBe(1);
    // The bug: 3 equal days split 1 vs 2 → 2.0. Symmetric split drops the middle → 1.0.
    expect(trendRatio([1, 1, 1])).toBe(1);
    expect(trendRatio([2, 2, 2, 2, 2])).toBe(1);
  });

  it('rising spend is >1, falling spend is <1', () => {
    expect(trendRatio([1, 1, 4, 4])).toBe(4); // (4+4)/(1+1)
    expect(trendRatio([4, 4, 1, 1])).toBe(0.25); // (1+1)/(4+4)
    // Odd: middle day dropped, compares ends only.
    expect(trendRatio([1, 99, 3])).toBe(3); // second end 3 / first end 1
  });

  it('empty / single-point / all-zero series default to 1 (no divide-by-zero)', () => {
    expect(trendRatio([])).toBe(1);
    expect(trendRatio([5])).toBe(1);
    expect(trendRatio([0, 0, 0])).toBe(1);
  });
});
