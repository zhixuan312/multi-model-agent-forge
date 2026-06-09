/**
 * Export-root resolution + the two load-bearing path invariants (Spec 8
 * §"Two load-bearing path invariants", F16/F23).
 *
 *  1. The export root must resolve OUTSIDE every project-repo working tree —
 *     never a prefix of, nor prefixed by, any `repo.path_on_disk`. Asserted at
 *     startup (`assertExportRootDisjoint`); a violation throws (fatal boot).
 *  2. The fully-resolved write path is re-checked to stay under
 *     `<root>/<project_id>/` before any write (`resolveProjectExportPath`); a
 *     traversal candidate throws.
 *
 * No DB import here — `assertExportRootDisjoint` takes the repo paths as an
 * argument so it stays pure + unit-testable; `startup.ts` supplies them via
 * `SELECT path_on_disk FROM repo`.
 */
import { resolve, sep } from 'node:path';

/** Thrown when an export path would escape its sandbox or overlap a repo tree. */
export class ExportPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportPathError';
  }
}

/** True when `a` is a prefix of, or equal to, `b` at a path-segment boundary. */
function isPrefixOrEqual(a: string, b: string): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  if (ra === rb) return true;
  return rb.startsWith(ra.endsWith(sep) ? ra : ra + sep);
}

/**
 * Assert the export root is disjoint from every registered repo path (invariant
 * #1). Disjoint ⟺ neither directory contains the other. Throws `ExportPathError`
 * on overlap. `repoPaths` is `SELECT path_on_disk FROM repo`.
 */
export function assertExportRootDisjoint(exportRoot: string, repoPaths: string[]): void {
  const root = resolve(exportRoot);
  for (const rp of repoPaths) {
    if (!rp || rp.trim() === '') continue;
    if (isPrefixOrEqual(root, rp) || isPrefixOrEqual(rp, root)) {
      throw new ExportPathError(
        `FORGE_EXPORT_ROOT (${root}) overlaps a repo working tree (${resolve(rp)}); exports must live outside every repo.`,
      );
    }
  }
}

/** The per-project export directory `<root>/<project_id>`. */
export function projectExportDir(exportRoot: string, projectId: string): string {
  return resolve(exportRoot, projectId);
}

/**
 * Resolve a write path under `<root>/<project_id>/<fileName>` and assert it
 * stays inside that dir (invariant #2). `fileName` is already slugified by the
 * caller; this is the defensive re-check — a `/`/`..`/NUL that survived slugging
 * (it never should) is rejected here. Throws `ExportPathError` on escape.
 */
export function resolveProjectExportPath(
  exportRoot: string,
  projectId: string,
  fileName: string,
): string {
  if (fileName.includes('\0')) {
    throw new ExportPathError('Export filename contains a NUL byte.');
  }
  const dir = projectExportDir(exportRoot, projectId);
  const candidate = resolve(dir, fileName);
  if (candidate !== dir && !candidate.startsWith(dir + sep)) {
    throw new ExportPathError(`Resolved export path escapes the project export dir: ${candidate}`);
  }
  return candidate;
}
