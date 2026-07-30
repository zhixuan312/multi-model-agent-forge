/**
 * Git-ref-safe slug rules (F22/F25). Used by the project branch name
 * (`mma/<created-date>-<project-slug>`, built in build/execute-core.ts), by project-name
 * uniqueness in projects/projects-core.ts, and by repo-name slugging.
 *
 * Slug rule: lowercase, replace any char outside `[a-z0-9._-]` with `-`, collapse
 * repeats, strip leading `-`/`.` and trailing `/`/`.`/`-`, forbid `..`.
 */

/** Slug a single ref component (a project name or a repo name). */
export function slugRefComponent(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/[^a-z0-9._-]/g, '-');
  s = s.replace(/-+/g, '-'); // collapse repeated dashes
  s = s.replace(/\.\.+/g, '.'); // forbid `..` (git ref rule); collapse dotted runs
  s = s.replace(/^[-.]+/, ''); // strip leading - and .
  s = s.replace(/[/.-]+$/, ''); // strip trailing /, ., and - (spec: trailing /,. ; - also for cleanliness)
  return s;
}
