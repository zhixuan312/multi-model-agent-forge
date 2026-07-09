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
 * the journal filesystem reads sit under. Stored team paths are normally absolute
 * (updateTeam persists the resolved path), but a bare/relative value (legacy seed
 * data) is resolved against the operator base so callers never hand MMA a
 * relative cwd (MMA rejects it with `invalid_cwd`). An empty value falls back to
 * the global workspace root.
 */
export function resolveTeamWorkspaceRoot(team: { workspaceRootPath: string }): string {
  const p = team.workspaceRootPath?.trim() ?? '';
  if (!p) return resolveWorkspaceRoot();
  return isAbsolute(p) ? p : resolve(resolveWorkspaceBase(), p);
}

export interface TeamWorkspacePathValidation {
  ok: boolean;
  /** The absolute path to persist (present only when `ok`). */
  path?: string;
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

  const realpath =
    opts.realpath ??
    ((p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    });

  // A bare/relative segment resolves under the base; an absolute path stays put.
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(base, trimmed);

  const realBase = realpath(base);
  // Canonicalise the leaf when it exists (catches a leaf symlink that escapes);
  // otherwise canonicalise the parent and re-append the leaf so a new team root
  // still validates. The leaf's own future contents are out of scope.
  let realAbs: string;
  try {
    realAbs = realpath(abs);
  } catch {
    realAbs = join(realpath(dirname(abs)), basename(abs));
  }

  if (realAbs === realBase) {
    return { ok: false, reason: 'Workspace path must be a directory below the base, not the base itself.' };
  }
  if (dirname(realAbs) !== realBase) {
    return { ok: false, reason: 'Workspace path must be a direct child of the operator workspace base.' };
  }
  return { ok: true, path: abs };
}
