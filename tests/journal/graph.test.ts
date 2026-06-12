import { buildGraphEdges } from '@/journal/graph';
import type { NodeFrontmatter } from '@/journal/store-reader';

const fm = (id: string, links: { type: string; target: string }[], supersededBy: string | null = null): NodeFrontmatter =>
  ({ id, links, supersededBy }) as NodeFrontmatter;

describe('buildGraphEdges', () => {
  it('emits one typed edge per link, source → target', () => {
    const ids = new Set(['0001', '0003']);
    const edges = buildGraphEdges([fm('0001', [{ type: 'relates', target: '0003' }]), fm('0003', [])], ids);
    expect(edges).toEqual([{ source: '0001', target: '0003', type: 'relates' }]);
  });

  it('collapses a `supersedes` link + the `supersededBy` back-pointer into ONE edge', () => {
    const ids = new Set(['0002', '0006']);
    const edges = buildGraphEdges(
      [fm('0002', [{ type: 'supersedes', target: '0006' }]), fm('0006', [], '0002')],
      ids,
    );
    // superseder → superseded, deduped (not two edges)
    expect(edges).toEqual([{ source: '0002', target: '0006', type: 'supersedes' }]);
  });

  it('synthesizes a supersedes edge from `supersededBy` alone (no explicit link)', () => {
    const ids = new Set(['0002', '0006']);
    const edges = buildGraphEdges([fm('0006', [], '0002'), fm('0002', [])], ids);
    expect(edges).toEqual([{ source: '0002', target: '0006', type: 'supersedes' }]);
  });

  it('drops dangling edges (target not a known node) and self-loops', () => {
    const ids = new Set(['0001']);
    const edges = buildGraphEdges(
      [fm('0001', [{ type: 'relates', target: '9999' }, { type: 'relates', target: '0001' }])],
      ids,
    );
    expect(edges).toEqual([]);
  });
});
