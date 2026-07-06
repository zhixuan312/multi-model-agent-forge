import { lastReadBlockId } from '@/details/read';

describe('lastReadBlockId', () => {
  it('returns the last attempt with a non-null block id', () => {
    expect(lastReadBlockId([
      { contextBlockId: 'A' },
      { contextBlockId: null },
      { contextBlockId: 'B' },
    ])).toBe('B');
  });
  it('skips trailing null/absent attempts (e.g. a fix attempt) back to the read attempt', () => {
    expect(lastReadBlockId([{ contextBlockId: 'A' }, { contextBlockId: null }])).toBe('A');
    expect(lastReadBlockId([{ contextBlockId: 'A' }, {}])).toBe('A');
  });
  it('returns null when there is no usable block id, or attempts is undefined/empty', () => {
    expect(lastReadBlockId([{ contextBlockId: null }, {}])).toBeNull();
    expect(lastReadBlockId([])).toBeNull();
    expect(lastReadBlockId(undefined)).toBeNull();
  });
});
