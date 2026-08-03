/**
 * Resolve the Forge workspace root: `FORGE_WORKSPACE_ROOT` env, else
 * `<cwd>/.forge-workspace`. Repos clone under `<root>/<name>` and `path_on_disk`
 * is the absolute path MMA later receives as `?cwd=`.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export function resolveWorkspaceRoot(): string {
  const env = process.env.FORGE_WORKSPACE_ROOT?.trim();
  if (env) return isAbsolute(env) ? env : resolve(process.cwd(), env);
  return join(process.cwd(), '.forge-workspace');
}

export function resolveWorkspaceBase(): string {
  const env = process.env.FORGE_WORKSPACE_BASE?.trim();
  if (env) return isAbsolute(env) ? env : resolve(process.cwd(), env);
  return dirname(resolveWorkspaceRoot());
}

/**
 * The absolute workspace root for a team — what MMA receives as `?cwd=` and what
 * the journal filesystem reads sit under.
 *
 * The stored value is a path RELATIVE to the operator base (just the team's leaf
 * segment), so a database backup is portable between hosts whose bases differ:
 * restoring a dump into a container with `FORGE_WORKSPACE_BASE=/workspace` lands
 * every team at `/workspace/<leaf>` with no manual path rewrite. An
 * already-ABSOLUTE stored value is still honoured verbatim — rows written before
 * that change (and any hand-edited row) must keep resolving. An empty value falls
 * back to the global workspace root.
 *
 * Either way the result is absolute: MMA rejects a relative cwd with `invalid_cwd`.
 */
export function resolveTeamWorkspaceRoot(team: { workspaceRootPath: string }): string {
  const p = team.workspaceRootPath?.trim() ?? '';
  if (!p) return resolveWorkspaceRoot();
  return isAbsolute(p) ? p : resolve(resolveWorkspaceBase(), p);
}

/**
 * Normalise a candidate workspace path to the form that gets STORED: the leaf,
 * relative to the operator base. This is the un-validated counterpart of
 * `validateTeamWorkspacePath` — for the create paths, which historically accepted
 * whatever the org admin typed. It only changes the ENCODING of the same
 * directory (`/workspace/acme` and `acme` both store as `acme`), so a database
 * dump restored onto a host with a different base still resolves.
 *
 * A degenerate candidate with no leaf (e.g. `/`) is returned unchanged rather
 * than collapsed to an empty string, which the NOT NULL column would reject.
 */
export function toStoredWorkspacePath(candidate: string): string {
  const trimmed = candidate.trim();
  const leaf = basename(trimmed);
  return leaf === '' ? trimmed : leaf;
}

export interface TeamWorkspacePathValidation {
  ok: boolean;
  /**
   * The value to PERSIST (present only when `ok`) — relative to the operator
   * base, so the row survives a move to a host with a different base. Resolve it
   * with `resolveTeamWorkspaceRoot` before handing it to MMA or the filesystem.
   */
  path?: string;
  /** The resolved absolute path the candidate validated as (present only when `ok`). */
  absolutePath?: string;
  /** Human-readable rejection reason (present only when `!ok`). */
  reason?: string;
}

/**
 * FR-8: validate a candidate team workspace root. A team root must be a direct
 * child of the operator base (`<base>/<segment>`) — teams are siblings, never
 * nested — and must not, after canonical (realpath) resolution, escape the base
 * subtree. A bare or relative segment resolves under the base. `realpath` is
 * injectable for testing; the default canonicalises the leaf if it exists, else
 * the deepest existing ancestor (a not-yet-created team root is allowed).
 *
 * Every check runs on the RESOLVED ABSOLUTE path (that is the only form in which
 * "direct child of the base" and "no symlink escape" mean anything), but what
 * comes back in `path` is the base-relative leaf — the host-portable value to
 * store. `absolutePath` carries the resolved form for callers that need it now.
 */
export function validateTeamWorkspacePath(
  candidate: string,
  opts: { base?: string; realpath?: (p: string) => string } = {},
): TeamWorkspacePathValidation {
  const trimmed = candidate.trim();
  if (!trimmed) return { ok: false, reason: 'Workspace path is required.' };

  const base = opts.base
    ? isAbsolute(opts.base)
      ? resolve(opts.base)
      : resolve(process.cwd(), opts.base)
    : resolveWorkspaceBase();

  // The default THROWS on a missing path so the ancestor fallback below can run. It used
  // to swallow and return the path unchanged, which meant that fallback never fired: under
  // a symlinked base — /tmp on macOS, or any mounted workspace — a not-yet-created team
  // root compared an uncanonicalised parent against the canonical base and was rejected.
  const realpath = opts.realpath ?? realpathSync;

  // A bare/relative segment resolves under the base; an absolute path stays put.
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(base, trimmed);

  // Canonicalise where possible, fall back to the lexical path where not: the base may
  // legitimately not exist yet (a fresh deployment, or a test naming a path off-disk), and
  // that must yield a validation RESULT rather than throwing out of the validator.
  const canonical = (p: string): string => {
    try {
      return realpath(p);
    } catch {
      return p;
    }
  };

  const realBase = canonical(base);
  // Canonicalise the leaf when it exists (catches a leaf symlink that escapes);
  // otherwise canonicalise the parent and re-append the leaf so a new team root
  // still validates. The leaf's own future contents are out of scope.
  let realAbs: string;
  try {
    realAbs = realpath(abs);
  } catch {
    // The leaf does not exist yet — canonicalise its PARENT and re-append, so a NEW team
    // root still validates through a symlinked base. If the parent is missing too, the
    // lexical path is the best answer available and the direct-child check below decides.
    realAbs = join(canonical(dirname(abs)), basename(abs));
  }

  if (realAbs === realBase) {
    return { ok: false, reason: 'Workspace path must be a directory below the base, not the base itself.' };
  }
  if (dirname(realAbs) !== realBase) {
    return { ok: false, reason: 'Workspace path must be a direct child of the operator workspace base.' };
  }
  // Persist the leaf, not `abs`: it is the same directory expressed relative to
  // whatever base the running host has, which is what makes a DB dump portable.
  return { ok: true, path: basename(abs), absolutePath: abs };
}
