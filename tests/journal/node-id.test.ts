// @vitest-environment node
import { isNodeId } from '@/journal/node-id';

/**
 * This predicate is half of a defence-in-depth pair: the API route rejects a bad id before
 * the reader runs, and the reader rejects it again. Both now call this, so these cases pin
 * BOTH guards at once.
 */
describe('isNodeId', () => {
  it('accepts exactly four digits, across the whole range (no <1000 cap — F17)', () => {
    for (const id of ['0000', '0001', '0999', '1000', '9999']) {
      expect(isNodeId(id), id).toBe(true);
    }
  });

  it('rejects the traversal and wrong-shape inputs the guard exists for', () => {
    for (const id of ['../etc', '../../0001', 'nodes/0001', '12', '12345', 'abc', '', ' 0001', '0001 ', '00o1', '-001', '0001.md']) {
      expect(isNodeId(id), id).toBe(false);
    }
  });

  it('rejects a newline-smuggled id — ^ and $ must not be line anchors', () => {
    expect(isNodeId('0001\n../etc')).toBe(false);
    expect(isNodeId('../etc\n0001')).toBe(false);
  });
});
