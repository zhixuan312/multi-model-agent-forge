/**
 * Git-ref-safe slug rules (F22/F25). Used by the project branch name
 * (`forge/<project-slug>-<short-id>`, built in build/execute-core.ts) and repo-name
 * slugging.
 *
 * Slug rule: lowercase, replace any char outside `[a-z0-9._-]` with `-`, collapse
 * repeats, strip leading `-`/`.` and trailing `/`/`.`/`-`, forbid `..`.
 */

/** Slug a single ref component (a project-short-id or a repo name). */
export function slugRefComponent(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/[^a-z0-9._-]/g, '-');
  s = s.replace(/-+/g, '-'); // collapse repeated dashes
  s = s.replace(/\.\.+/g, '.'); // forbid `..` (git ref rule); collapse dotted runs
  s = s.replace(/^[-.]+/, ''); // strip leading - and .
  s = s.replace(/[/.-]+$/, ''); // strip trailing /, ., and - (spec: trailing /,. ; - also for cleanliness)
  return s;
}

/** A stable short `<run>` token from a project id (the project IS the run, §Data model). */
export function projectShortId(projectId: string): string {
  // First dashless segment of the uuid (8 hex chars) — stable + ref-safe.
  const first = projectId.split('-')[0] ?? projectId;
  return slugRefComponent(first);
}
