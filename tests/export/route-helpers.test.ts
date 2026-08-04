// @vitest-environment node
import { parseExportKind } from '@/export/route-helpers';
import { EXPORT_KINDS } from '@/export/types';

/**
 * The three deliverable kinds were written out FOUR times: the union in `types.ts`, plus
 * identical `ExportKind[]` arrays in `collect-artifacts` (`DELIVERABLE_KINDS`),
 * `combined-html` (`ORDER`) and here (`KINDS`) — and the last of those is the validator that
 * decides which kinds a caller may request. The array is the source now and the type derives
 * from it, so the validator and the collectors cannot disagree about the set OR its order.
 */
describe('the export kinds are one list', () => {
  it('accepts exactly the deliverable kinds', () => {
    for (const kind of EXPORT_KINDS) expect(parseExportKind(kind)).toBe(kind);
  });

  it('still rejects a kind that is not a deliverable', () => {
    expect(parseExportKind('exploration_brief')).toBeNull();
    expect(parseExportKind('journal')).toBeNull();
    expect(parseExportKind('')).toBeNull();
    expect(parseExportKind(null)).toBeNull();
  });

  it('keeps the fixed authoring order the combined export renders in', () => {
    expect([...EXPORT_KINDS]).toEqual(['exploration', 'spec', 'plan']);
  });
});
