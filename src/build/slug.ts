/**
 * Git-ref-safe slug rules (F22/F25). Used by the project branch name
 * (`mma/<created-date>-<project-slug>`, built in build/execute-core.ts), the loop-run
 * branch (loops/run-engine.ts), and project-name uniqueness (projects/projects-core.ts).
 *
 * Slug rule: lowercase, replace any char outside `[a-z0-9._-]` with `-`, collapse
 * repeats, strip leading `-`/`.` and trailing `/`/`.`/`-`, forbid `..`.
 *
 * NOT the only normaliser, and deliberately so — three others target different grammars
 * and must NOT be folded into this one:
 *   - `git/repos-core.ts#toRepoSlug`      — a DIRECTORY name; separator is `_`.
 *   - `export/slug.ts#slug`               — a FILENAME; NFKD-folds accents, caps length,
 *                                           falls back to 'untitled'.
 *   - `journal/project-journal-topic.ts`  — the engine's topic grammar
 *                                           `^[a-z0-9]+(-[a-z0-9]+)*$`, which FORBIDS the
 *                                           `.` and `_` this rule keeps.
 * (This doc claimed repo-name slugging; that is `toRepoSlug`, which this never fed.)
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
