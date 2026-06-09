// @vitest-environment node
import { filterRepos, type RepoForFilter } from '@/git/repo-filter';

const A: RepoForFilter = { name: 'core-api', kind: 'library', tags: ['core', 'backend'] };
const B: RepoForFilter = { name: 'web', kind: 'service', tags: ['frontend'] };
const C: RepoForFilter = { name: 'core-docs', kind: 'docs', tags: ['core'] };
const all = [A, B, C];

describe('filterRepos (Flow E semantics, F1/F8)', () => {
  it('kind=library + tag=core + search=api → only A', () => {
    expect(filterRepos(all, { kind: 'library', tag: 'core', search: 'api' })).toEqual([A]);
  });

  it('search=core alone → A and C (name/tags substring), not B', () => {
    expect(filterRepos(all, { search: 'core' })).toEqual([A, C]);
  });

  it('an unset predicate is a pass-through (no filter)', () => {
    expect(filterRepos(all, {})).toEqual(all);
  });

  it('kind match is case-insensitive exact', () => {
    expect(filterRepos(all, { kind: 'LIBRARY' })).toEqual([A]);
  });

  it('tag match is array-contains, case-insensitive', () => {
    expect(filterRepos(all, { tag: 'CORE' })).toEqual([A, C]);
  });

  it('search matches name OR a tag element, case-insensitive substring; not kind/path', () => {
    expect(filterRepos(all, { search: 'front' })).toEqual([B]); // tag "frontend"
    expect(filterRepos(all, { search: 'library' })).toEqual([]); // kind is NOT searched
  });

  it('combines predicates with AND', () => {
    expect(filterRepos(all, { kind: 'docs', tag: 'core' })).toEqual([C]);
    expect(filterRepos(all, { kind: 'library', search: 'docs' })).toEqual([]);
  });
});
