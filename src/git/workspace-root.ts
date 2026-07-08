/**
 * Resolve the Forge workspace root: `FORGE_WORKSPACE_ROOT` env, else
 * `<cwd>/.forge-workspace`. Repos clone under `<root>/<name>` and `path_on_disk`
 * is the absolute path MMA later receives as `?cwd=`.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CurrentTeam } from '@/auth/team-scope';

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

export function resolveTeamWorkspaceRoot(team: CurrentTeam): string {
  return team.workspaceRootPath;
}
