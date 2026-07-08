import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { team } from '@/db/schema/team';
import { member, memberIdentity } from '@/db/schema/identity';
import { createMemberSchema } from '@/auth/members-core';
import { hashPassword } from '@/auth/password';
import { validateTeamWorkspacePath } from '@/git/workspace-root';

export interface TeamsDeps {
  db?: Db;
}

/** Derive a human team name from its slug — the slug is the single identifier the
 *  org admin sets. e.g. `platform-team` → `Platform Team`. */
export function nameFromSlug(slug: string): string {
  return slug
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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

// A team has no members until its admin exists, and the org admin can never join
// a team — so a team and its first team_admin are provisioned together (FR-9).
// The slug is the single identifier; the display name is derived from it.
const createTeamWithAdminSchema = z.object({
  slug: z.string().trim().min(1),
  workspaceRootPath: z.string().trim().min(1),
  admin: createMemberSchema,
});

type CreatedTeam = { id: string; name: string; slug: string; workspaceRootPath: string; gitTokenRef: string | null };

export type CreateTeamWithAdminResult =
  | { kind: 'created'; team: CreatedTeam; admin: { id: string; username: string } }
  | { kind: 'invalid' }
  | { kind: 'duplicate_username' };

/**
 * Create a team AND its first team_admin member in one transaction. The org
 * admin supplies the team fields plus the admin's username + initial password;
 * the member is bound to the new team with role `team_admin`. If the admin
 * username is taken, nothing is written (no orphan team).
 */
export async function createTeamWithAdmin(
  input: unknown,
  deps: TeamsDeps = {},
): Promise<CreateTeamWithAdminResult> {
  const parsed = createTeamWithAdminSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const db = deps.db ?? getDb();
  const { slug, workspaceRootPath, admin } = parsed.data;
  const name = nameFromSlug(slug);

  // Case-insensitive pre-check (the functional unique index is the real guard).
  const [existing] = await db
    .select({ id: member.id })
    .from(member)
    .where(sql`lower(${member.username}) = lower(${admin.username})`)
    .limit(1);
  if (existing) return { kind: 'duplicate_username' };

  const passwordHash = await hashPassword(admin.password);

  try {
    const result = await db.transaction(async (tx) => {
      const [t] = await tx.insert(team).values({ name, slug, workspaceRootPath }).returning();
      const [m] = await tx
        .insert(member)
        .values({ username: admin.username, displayName: admin.displayName, role: 'team_admin', teamId: t.id })
        .returning({ id: member.id, username: member.username });
      await tx.insert(memberIdentity).values({ memberId: m.id, passwordHash });
      return { team: t, admin: m };
    });
    return { kind: 'created', team: result.team, admin: result.admin };
  } catch {
    // Unique-violation race on the username index → duplicate.
    return { kind: 'duplicate_username' };
  }
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

const updateTeamSchema = z.object({
  slug: z.string().trim().min(1).optional(),
  workspaceRootPath: z.string().trim().min(1).optional(),
});

export type UpdateTeamResult = { kind: 'saved' } | { kind: 'invalid'; reason: string };

/**
 * Org-admin edit of an existing team's slug / workspace root. Only the fields
 * provided are changed; the display name is re-derived whenever the slug changes.
 * A new workspace path is validated against the operator base (direct sibling
 * child, no symlink escape) and stored resolved.
 */
export async function updateTeam(
  candidate: unknown,
  deps: UpdateWorkspacePathDeps,
): Promise<UpdateTeamResult> {
  const parsed = updateTeamSchema.safeParse(candidate);
  if (!parsed.success) return { kind: 'invalid', reason: 'Invalid team fields.' };
  const { slug, workspaceRootPath } = parsed.data;
  if (!slug && !workspaceRootPath) return { kind: 'invalid', reason: 'Nothing to update.' };

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (slug) {
    set.slug = slug;
    set.name = nameFromSlug(slug);
  }
  if (workspaceRootPath) {
    const validation = validateTeamWorkspacePath(workspaceRootPath, { base: deps.base, realpath: deps.realpath });
    if (!validation.ok || !validation.path) {
      return { kind: 'invalid', reason: validation.reason ?? 'Invalid workspace path.' };
    }
    set.workspaceRootPath = validation.path;
  }

  const db = deps.db ?? getDb();
  await db.update(team).set(set).where(eq(team.id, deps.teamId));
  return { kind: 'saved' };
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
