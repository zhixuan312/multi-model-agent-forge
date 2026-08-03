// @vitest-environment node
/**
 * The exploration rail groups discovery tasks by kind, and it builds those groups by
 * ITERATING a list — so whatever that list omits, the user never sees. It used to iterate a
 * local `KIND_ORDER` map declared inside the component, one of what turned out to be eight
 * hand-written copies of the three kinds. A task whose kind was missing from that particular
 * copy rendered nowhere: dispatched, paid for, completed, and absent from the stage with no
 * empty state to explain the gap.
 *
 * It now iterates `GROUPS`, the per-kind descriptor the fan-out editor already renders. This
 * holds `GROUPS` to the enum, both directions — the "every phase a row can carry" rule from
 * the usage-table and stage-phase fixes, applied to the third list that had it.
 */
import { GROUPS } from '@/components/forge/ExploreStageClient';
import { DISCOVER_TASK_KIND } from '@/db/enums';

describe('exploration fan-out groups', () => {
  it('covers every discovery kind, in the enum’s order', () => {
    expect(GROUPS.map((g) => g.kind)).toEqual([...DISCOVER_TASK_KIND]);
  });

  it('gives each kind a human label, never the raw key', () => {
    for (const g of GROUPS) {
      expect(g.label.trim(), g.kind).not.toBe('');
      expect(g.label, `"${g.kind}" is shown to the user by its enum key`).not.toBe(g.kind);
      expect(g.desc.trim(), g.kind).not.toBe('');
    }
  });

  /**
   * `investigate` reads a repo, so it needs one named per task; the other two read the web
   * and the team journal and must NOT carry a repo. `explore-propose` rejects a proposal that
   * gets this backwards, and the editor decides which control to render from `source`.
   */
  it('marks the repo-scoped kind by having no fixed source', () => {
    const bySource = Object.fromEntries(GROUPS.map((g) => [g.kind, g.source]));
    expect(bySource.investigate).toBeNull();
    for (const [kind, source] of Object.entries(bySource)) {
      if (kind !== 'investigate') expect(source, kind).toBeTruthy();
    }
  });
});
