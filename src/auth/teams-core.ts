import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';
import { validateTeamWorkspacePath } from '@/git/workspace-root';

export interface TeamsDeps {
  db?: Db;
}

const createTeamSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  workspaceRootPath: z.string().trim().min(1),
});

export type CreateTeamResult = { kind: 'created'; team: { id: string; name: string; slug: string; workspaceRootPath: string; gitTokenRef: string | null } } | { kind: 'invalid' };

export async function createTeam(
  input: unknown,
  deps: TeamsDeps = {},
): Promise<CreateTeamResult> {
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const db = deps.db ?? getDb();
  const [created] = await db.insert(team).values(parsed.data).returning();
  return { kind: 'created', team: created };
}

export type UpdateWorkspacePathResult =
  | { kind: 'saved'; workspaceRootPath: string }
  | { kind: 'invalid'; reason: string };

export interface UpdateWorkspacePathDeps extends TeamsDeps {
  teamId: string;
  /** Operator base override (defaults to `resolveWorkspaceBase()`); test seam. */
  base?: string;
  /** Realpath override; test seam. */
  realpath?: (p: string) => string;
}

/**
 * FR-8 + FR-9: a team-admin sets their own team's workspace root. Validates the
 * candidate against the operator base (direct sibling child, no symlink escape)
 * BEFORE persisting; the stored value is the resolved absolute path.
 */
export async function updateTeamWorkspacePath(
  candidate: string,
  deps: UpdateWorkspacePathDeps,
): Promise<UpdateWorkspacePathResult> {
  const validation = validateTeamWorkspacePath(candidate, { base: deps.base, realpath: deps.realpath });
  if (!validation.ok || !validation.path) {
    return { kind: 'invalid', reason: validation.reason ?? 'Invalid workspace path.' };
  }
  const db = deps.db ?? getDb();
  await db
    .update(team)
    .set({ workspaceRootPath: validation.path, updatedAt: new Date() })
    .where(eq(team.id, deps.teamId));
  return { kind: 'saved', workspaceRootPath: validation.path };
}

export type AssignTeamAdminResult = { kind: 'assigned' } | { kind: 'not_found' };

export async function assignTeamAdmin(
  teamId: string,
  memberId: string,
  deps: TeamsDeps = {},
): Promise<AssignTeamAdminResult> {
  const db = deps.db ?? getDb();
  const [target] = await db
    .select()
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  if (!target || target.teamId !== teamId) return { kind: 'not_found' };
  await db.update(member).set({ role: 'team_admin' }).where(eq(member.id, memberId));
  return { kind: 'assigned' };
}
