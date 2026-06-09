/**
 * Workspace filter semantics (Spec 2 §Flow E, F1/F8). Pure + shared so the
 * client filter island and tests use one definition.
 *
 * Three independent predicates combined with AND (unset = pass-through):
 *   - kind  : case-insensitive EXACT match on repo.kind.
 *   - tag   : repo.tags CONTAINS the tag (exact, case-insensitive).
 *   - search: case-insensitive SUBSTRING over (name ∪ each tag). NOT kind/path.
 */
export interface RepoForFilter {
  name: string;
  kind: string;
  tags: string[];
}

export interface RepoFilter {
  kind?: string | null;
  tag?: string | null;
  search?: string | null;
}

export function filterRepos<T extends RepoForFilter>(repos: T[], filter: RepoFilter): T[] {
  const kind = filter.kind?.trim().toLowerCase() || null;
  const tag = filter.tag?.trim().toLowerCase() || null;
  const search = filter.search?.trim().toLowerCase() || null;

  return repos.filter((r) => {
    if (kind !== null && r.kind.toLowerCase() !== kind) return false;
    if (tag !== null && !r.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (search !== null) {
      const haystack = [r.name, ...r.tags].map((s) => s.toLowerCase());
      if (!haystack.some((s) => s.includes(search))) return false;
    }
    return true;
  });
}
