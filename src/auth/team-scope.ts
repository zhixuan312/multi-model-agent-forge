import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import type { AuthedMember } from '@/auth/auth-provider';
import { getDb, type Db } from '@/db/client';
import { team } from '@/db/schema/team';
import type { ProjectActor } from '@/projects/projects-core';

export interface CurrentTeam {
  id: string;
  name: string;
  slug: string;
  workspaceRootPath: string;
  gitTokenRef: string | null;
}

export interface TeamScope {
  actor: AuthedMember;
  currentTeam: CurrentTeam;
}

export interface TeamScopeDeps {
  db?: Db;
}

export async function requireTeamScope(deps: TeamScopeDeps = {}): Promise<TeamScope> {
  const actor = await currentMember();
  if (!actor) throw new Error('Authentication required.');
  if (!actor.teamId) throw new Error('Team scope required.');

  const db = deps.db ?? getDb();
  const [row] = await db.select().from(team).where(eq(team.id, actor.teamId)).limit(1);
  if (!row) throw new Error('Current team not found.');

  return {
    actor,
    currentTeam: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      workspaceRootPath: row.workspaceRootPath,
      gitTokenRef: row.gitTokenRef,
    },
  };
}

export function assertOrgAdmin(actor: AuthedMember): void {
  if (actor.role !== 'org_admin') throw new Error('Org admin required.');
}

export function assertTeamAdmin(actor: AuthedMember, teamId: string): void {
  if (actor.role !== 'team_admin' || actor.teamId !== teamId) throw new Error('Team admin required.');
}

export function projectActorFromMember(actor: Pick<AuthedMember, 'id' | 'teamId'>): ProjectActor | null {
  if (!actor.teamId) return null;
  return { id: actor.id, teamId: actor.teamId };
}
