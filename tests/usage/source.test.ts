// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { USAGE_SOURCES, SOURCE_FILTER_LABEL, SOURCE_ROW_LABEL } from '@/usage/source';

/**
 * The union was written out four times (`usage-core` ×2, `UsageBatchTable`'s
 * `SourceFilter`, `UsageTabsNav`'s `UsageView`) and its two label sets lived inline —
 * the filter's short names as `<SelectItem>`s, the row's long names in a nested ternary.
 * Adding a source meant finding all six.
 */
describe('usage sources', () => {
  it('labels every source, both ways', () => {
    expect(Object.keys(SOURCE_FILTER_LABEL).sort()).toEqual([...USAGE_SOURCES].sort());
    expect(Object.keys(SOURCE_ROW_LABEL).sort()).toEqual([...USAGE_SOURCES].sort());
  });

  it('gives each source a distinct label in both sets', () => {
    expect(new Set(Object.values(SOURCE_FILTER_LABEL)).size).toBe(USAGE_SOURCES.length);
    expect(new Set(Object.values(SOURCE_ROW_LABEL)).size).toBe(USAGE_SOURCES.length);
  });

  /** The row label qualifies the short one rather than renaming the thing. */
  it('keeps the row label a superset of the filter label', () => {
    for (const s of USAGE_SOURCES) {
      expect(SOURCE_ROW_LABEL[s].startsWith(SOURCE_FILTER_LABEL[s]), s).toBe(true);
    }
  });
});
