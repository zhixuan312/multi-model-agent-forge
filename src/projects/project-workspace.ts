import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
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
 * The artifact directories for MANY projects, in ONE query.
 *
 * `resolveProjectArtifactDir` resolves a single project by joining `project` to `team`, so
 * a caller holding N project ids issues N joined queries. The dashboard did exactly that,
 * up to three times per project (plan, then spec, then exploration) and strictly in series,
 * under a module docstring promising it "stays O(round-trips), never N+1".
 *
 * Same fallback semantics as the singular resolver: a project with no resolvable team root
 * gets the global workspace root, and an unavailable DB puts EVERY id there rather than
 * throwing.
 */
export async function resolveProjectArtifactDirs(
  projectIds: string[],
  db?: Db,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = projectIds.filter((id) => /^[a-z0-9-]+$/i.test(id));
  if (ids.length === 0) return out;

  const global = resolveWorkspaceRoot();
  const rootById = new Map<string, string>();
  try {
    const database = db ?? getDb();
    const rows = await database
      .select({ id: project.id, workspaceRootPath: team.workspaceRootPath })
      .from(project)
      .innerJoin(team, eq(project.teamId, team.id))
      .where(inArray(project.id, ids));
    for (const row of rows) {
      if (row.workspaceRootPath) {
        rootById.set(row.id, resolveTeamWorkspaceRoot({ workspaceRootPath: row.workspaceRootPath }));
      }
    }
  } catch {
    /* DB unavailable — every id degrades to the global root, as the singular resolver does */
  }
  for (const id of ids) out.set(id, join(rootById.get(id) ?? global, '.mma', 'projects', id));
  return out;
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
