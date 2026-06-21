// @vitest-environment node
import { filterRepos, type RepoForFilter } from '@/git/repo-filter';

const A: RepoForFilter = { name: 'core-api', tags: ['core', 'backend'] };
const B: RepoForFilter = { name: 'web', tags: ['frontend'] };
const C: RepoForFilter = { name: 'core-docs', tags: ['core'] };
const all = [A, B, C];

describe('filterRepos (Flow E semantics, F1/F8)', () => {
  it('tag=core + search=api → only A', () => {
    expect(filterRepos(all, { tag: 'core', search: 'api' })).toEqual([A]);
  });

  it('search=core alone → A and C (name/tags substring), not B', () => {
    expect(filterRepos(all, { search: 'core' })).toEqual([A, C]);
  });

  it('an unset predicate is a pass-through (no filter)', () => {
    expect(filterRepos(all, {})).toEqual(all);
  });

  it('tag match is array-contains, case-insensitive', () => {
    expect(filterRepos(all, { tag: 'CORE' })).toEqual([A, C]);
  });

  it('search matches name OR a tag element, case-insensitive substring; not path', () => {
    expect(filterRepos(all, { search: 'front' })).toEqual([B]); // tag "frontend"
    expect(filterRepos(all, { search: 'backend' })).toEqual([A]); // tag "backend"
  });

  it('combines predicates with AND', () => {
    expect(filterRepos(all, { tag: 'core', search: 'docs' })).toEqual([C]);
    expect(filterRepos(all, { tag: 'frontend', search: 'docs' })).toEqual([]);
  });
});
