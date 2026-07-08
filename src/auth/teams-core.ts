import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { team } from '@/db/schema/team';
import { member } from '@/db/schema/identity';

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
