import { describe, it, expect } from 'vitest';
import { formatCost, formatTokens, formatDuration, formatRoi } from '@/usage/format';

describe('formatCost', () => {
  it('formats null as dash', () => expect(formatCost(null)).toBe('—'));
  it('formats zero', () => expect(formatCost(0)).toBe('$0'));
  it('formats small amounts with 4 decimals', () => expect(formatCost(0.0069)).toBe('$0.0069'));
  it('formats normal amounts with 2 decimals', () => expect(formatCost(12.4)).toBe('$12.40'));
});

describe('formatTokens', () => {
  it('formats null as dash', () => expect(formatTokens(null)).toBe('—'));
  it('formats millions', () => expect(formatTokens(8_200_000)).toBe('8.2M'));
  it('formats thousands', () => expect(formatTokens(420_000)).toBe('420K'));
  it('formats thousands', () => expect(formatTokens(1200)).toBe('1K'));
  it('formats small numbers with commas', () => expect(formatTokens(999)).toBe('999'));
});

describe('formatDuration', () => {
  it('formats null as dash', () => expect(formatDuration(null)).toBe('—'));
  it('formats milliseconds', () => expect(formatDuration(500)).toBe('500ms'));
  it('formats seconds', () => expect(formatDuration(48_000)).toBe('48s'));
  it('formats minutes', () => expect(formatDuration(1_920_000)).toBe('32m'));
  it('formats hours', () => expect(formatDuration(15_120_000)).toBe('4.2h'));
});

describe('formatRoi', () => {
  it('formats null saved as dash', () => expect(formatRoi(null, 10)).toBe('—'));
  it('formats null actual as dash', () => expect(formatRoi(100, null)).toBe('—'));
  it('formats zero actual as dash', () => expect(formatRoi(100, 0)).toBe('—'));
  it('formats roi correctly', () => expect(formatRoi(187.2, 12.4)).toBe('16.1×'));
});
