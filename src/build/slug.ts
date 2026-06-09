/**
 * Git-ref-safe slug rules (Spec 7 §Error handling, F22/F25). Shared by the
 * plan-file naming (`plan-<project-short-id>.md`) and the per-run branch name
 * (`forge/<project-short-id>/<repo.name>`).
 *
 * Slug rule (Spec 7): lowercase, replace any char outside `[a-z0-9._-]` with
 * `-`, collapse repeats, strip leading `-`/`.` and trailing `/`/`.`, forbid `..`.
 * The branch name is additionally `git check-ref-format --branch`-validated by
 * GitOps before any `checkout -b` (that lives in branch.ts).
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

/** The per-run branch name `forge/<project-short-id>/<repo-slug>` (pre-validation). */
export function branchName(projectId: string, repoName: string): string {
  return `forge/${projectShortId(projectId)}/${slugRefComponent(repoName)}`;
}

/** The per-repo plan filename `plan-<project-short-id>.md` (lives under <repo>/.forge/). */
export function planFileName(projectId: string): string {
  return `plan-${projectShortId(projectId)}.md`;
}
