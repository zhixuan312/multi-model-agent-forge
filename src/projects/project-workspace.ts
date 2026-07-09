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
 * operator base). Falls back to the global workspace root only if the project or
 * its team can't be resolved.
 */
export async function resolveProjectWorkspaceRoot(projectId: string, db: Db = getDb()): Promise<string> {
  const [row] = await db
    .select({ workspaceRootPath: team.workspaceRootPath })
    .from(project)
    .innerJoin(team, eq(project.teamId, team.id))
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row?.workspaceRootPath) return resolveWorkspaceRoot();
  return resolveTeamWorkspaceRoot({ workspaceRootPath: row.workspaceRootPath });
}
