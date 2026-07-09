import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { team } from '@/db/schema/team';
import { resolveTeamWorkspaceRoot, resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * The absolute workspace root of a project's OWNING team — the `?cwd=` every MMA
 * dispatch for this project should use so the worker sees that team's journal and
 * repos (not another team's, and not a shared global root). Resolves through the
 * team's stored path (absolute, or a legacy relative value resolved against the
 * operator base). Falls back to the global workspace root if the project or its
 * team can't be resolved — including when the DB is unavailable (e.g. unit tests
 * that stub the workspace root but not the database), so callers degrade to the
 * legacy global location rather than throwing.
 */
export async function resolveProjectWorkspaceRoot(projectId: string, db?: Db): Promise<string> {
  try {
    const database = db ?? getDb();
    const [row] = await database
      .select({ workspaceRootPath: team.workspaceRootPath })
      .from(project)
      .innerJoin(team, eq(project.teamId, team.id))
      .where(eq(project.id, projectId))
      .limit(1);
    if (!row?.workspaceRootPath) return resolveWorkspaceRoot();
    return resolveTeamWorkspaceRoot({ workspaceRootPath: row.workspaceRootPath });
  } catch {
    return resolveWorkspaceRoot();
  }
}

/**
 * The absolute workspace root of a team by its id — the `?cwd=` for team-level
 * (not project-scoped) MMA work and the base for the team journal. Same relative
 * resolution + DB-unavailable fallback semantics as `resolveProjectWorkspaceRoot`.
 */
export async function resolveTeamWorkspaceRootById(teamId: string, db?: Db): Promise<string> {
  try {
    const database = db ?? getDb();
    const [row] = await database
      .select({ workspaceRootPath: team.workspaceRootPath })
      .from(team)
      .where(eq(team.id, teamId))
      .limit(1);
    if (!row?.workspaceRootPath) return resolveWorkspaceRoot();
    return resolveTeamWorkspaceRoot({ workspaceRootPath: row.workspaceRootPath });
  } catch {
    return resolveWorkspaceRoot();
  }
}

/**
 * The on-disk directory holding a project's markdown artifacts (spec, plan,
 * exploration, journal), now keyed to the owning TEAM's workspace root:
 * `<teamRoot>/.mma/projects/<projectId>/`. This sits alongside the team journal
 * (`<teamRoot>/.mma/journal/`) so all of a team's data lives under its own root.
 */
export async function resolveProjectArtifactDir(projectId: string, db?: Db): Promise<string> {
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error(`Invalid projectId: ${projectId}`);
  const root = await resolveProjectWorkspaceRoot(projectId, db);
  return join(root, '.mma', 'projects', projectId);
}
