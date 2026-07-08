import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { member, memberIdentity, session } from '@/db/schema/identity';
import { hashPassword, passwordSchema } from '@/auth/password';
import { sessionStore, type SessionStore } from '@/auth/session-store';

/**
 * Members CRUD core (Spec 1 §Members CRUD API). Dependency-injected and pure of
 * `next/headers` so it's unit-testable against the live DB. The route handlers
 * (`app/api/members/**`) are thin shells over these functions; admin gating +
 * operational logging live in the handlers.
 *
 * Verb → action contract (from the spec's Key flows table):
 *   POST   /api/members              → createMember
 *   PATCH  /api/members/[id]         → setMemberAdmin (toggle is_admin)
 *   DELETE /api/members/[id]         → deleteMember (hard delete)
 *   POST   /api/members/[id]/password → resetMemberPassword
 *
 * Last-admin invariant: an admin action must never drop the team's admin count
 * to zero — toggle-demote and delete both reject in that case (409). This is a
 * sane default stated by the spec ("cannot lock out the team").
 */

// ---- create ----

export const createMemberSchema = z.object({
  displayName: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: passwordSchema,
});

// createMember additionally accepts an optional role (an admin may create either
// a member or an admin); omitted → a non-admin member. Kept separate from
// `createMemberSchema`, which setup-core reuses for the first-admin path and must
// stay role-free.
const createMemberInputSchema = createMemberSchema.extend({
  isAdmin: z.boolean().optional(),
});

export interface CreatedMember {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  isAdmin: boolean;
}

export type CreateMemberResult =
  | { kind: 'created'; member: CreatedMember }
  | { kind: 'invalid' }
  | { kind: 'duplicate_username' };

export interface MembersDeps {
  db?: Db;
  store?: SessionStore;
  /** When set, scope member queries to this team (FR-9 team isolation). */
  teamId?: string;
}

/**
 * Create a member + exactly one `local` identity (argon2id hash). Username
 * uniqueness is case-insensitive — pre-checked against `lower(username)` AND
 * guarded by the `member_username_lower_uniq` functional unique index, so a
 * race that slips past the pre-check still surfaces as `duplicate_username`.
 */
export async function createMember(
  input: unknown,
  teamId: string,
  deps: MembersDeps = {},
): Promise<CreateMemberResult> {
  const db = deps.db ?? getDb();
  const parsed = createMemberInputSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { displayName, username, password } = parsed.data;
  const isAdmin = parsed.data.isAdmin ?? false;

  // Case-insensitive pre-check (the functional unique index is the real guard).
  const [existing] = await db
    .select({ id: member.id })
    .from(member)
    .where(sql`lower(${member.username}) = lower(${username})`)
    .limit(1);
  if (existing) return { kind: 'duplicate_username' };

  const passwordHash = await hashPassword(password);

  try {
    const created = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(member)
        .values({ username, displayName, role: isAdmin ? 'team_admin' : 'member', teamId })
        .returning({
          id: member.id,
          username: member.username,
          displayName: member.displayName,
          avatarTint: member.avatarTint,
          role: member.role,
        });
      // Exactly one identity per member (the one-identity rule).
      await tx.insert(memberIdentity).values({
        memberId: m.id,
        passwordHash,
      });
      return { ...m, isAdmin: m.role === 'team_admin' };
    });
    return { kind: 'created', member: created };
  } catch (err) {
    // Unique-index violation (case-insensitive race) → duplicate.
    if (isUniqueViolation(err)) return { kind: 'duplicate_username' };
    throw err;
  }
}

// ---- toggle admin ----

export const toggleAdminSchema = z.object({ isAdmin: z.boolean() });

export type SetAdminResult =
  | { kind: 'updated'; id: string; isAdmin: boolean }
  | { kind: 'invalid' }
  | { kind: 'not_found' }
  | { kind: 'last_admin' };

/**
 * Set a member's `is_admin`. Demoting (`isAdmin=false`) is rejected when the
 * member is currently the only admin (last-admin invariant → 409). Promoting is
 * always allowed; setting a value it already holds is a no-op success.
 */
export async function setMemberAdmin(
  memberId: string,
  input: unknown,
  deps: MembersDeps = {},
): Promise<SetAdminResult> {
  const db = deps.db ?? getDb();
  const parsed = toggleAdminSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const nextIsAdmin = parsed.data.isAdmin;

  const [target] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  if (!target) return { kind: 'not_found' };

  // Last-admin guard: demoting the only remaining admin would lock out the team.
  if (isAdminRole(target) && !nextIsAdmin) {
    const others = await countOtherAdmins(db, memberId);
    if (others === 0) return { kind: 'last_admin' };
  }

  await db
    .update(member)
    .set({ role: nextIsAdmin ? 'team_admin' : 'member' })
    .where(eq(member.id, memberId));
  return { kind: 'updated', id: memberId, isAdmin: nextIsAdmin };
}

// ---- reset password ----

export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

export type ResetPasswordResult =
  | { kind: 'reset' }
  | { kind: 'invalid' }
  | { kind: 'not_found' };

/**
 * Admin reset of a target member's password: set a new hash + bump
 * `password_changed_at` (DB clock, F19) so the target's existing sessions drop
 * on next validation, and proactively revoke them via the store. Returns no
 * secret.
 */
export async function resetMemberPassword(
  memberId: string,
  input: unknown,
  deps: MembersDeps = {},
): Promise<ResetPasswordResult> {
  const db = deps.db ?? getDb();
  const store = deps.store ?? sessionStore;
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };

  const [identity] = await db
    .select({ id: memberIdentity.id })
    .from(memberIdentity)
    .where(eq(memberIdentity.memberId, memberId))
    .limit(1);
  if (!identity) return { kind: 'not_found' };

  const newHash = await hashPassword(parsed.data.newPassword);
  await db
    .update(memberIdentity)
    .set({ passwordHash: newHash, passwordChangedAt: sql`now()` })
    .where(eq(memberIdentity.id, identity.id));

  // Drop the target's sessions now (validation would also reject them via the
  // password_changed_at bump; this is the proactive cleanup).
  await store.revokeAllForMember(memberId);
  return { kind: 'reset' };
}

// ---- delete ----

export type DeleteMemberResult =
  | { kind: 'deleted' }
  | { kind: 'not_found' }
  | { kind: 'last_admin' };

/**
 * Hard-delete a member (`ON DELETE CASCADE` removes its identities + sessions).
 * Rejected when the target is the only admin (deleting self-or-other-last-admin
 * would leave zero admins → 409).
 */
export async function deleteMember(
  memberId: string,
  deps: MembersDeps = {},
): Promise<DeleteMemberResult> {
  const db = deps.db ?? getDb();

  const { isForgeSystemMember } = await import('@/automation/forge-member');
  if (isForgeSystemMember(memberId)) return { kind: 'not_found' };

  const [target] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  if (!target) return { kind: 'not_found' };

  if (isAdminRole(target)) {
    const others = await countOtherAdmins(db, memberId);
    if (others === 0) return { kind: 'last_admin' };
  }

  await db.delete(member).where(eq(member.id, memberId));
  return { kind: 'deleted' };
}

// ---- list (RSC read) ----

export interface MemberListRow {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  isAdmin: boolean;
  createdAt: Date;
}

/** List members for the admin Members surface (newest-derived ordering: by name). */
export async function listMembers(deps: MembersDeps = {}): Promise<MemberListRow[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({
      id: member.id,
      username: member.username,
      displayName: member.displayName,
      avatarTint: member.avatarTint,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .where(deps.teamId ? eq(member.teamId, deps.teamId) : undefined)
    .orderBy(member.createdAt);
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarTint: row.avatarTint,
    isAdmin: row.role === 'team_admin' || row.role === 'org_admin',
    createdAt: row.createdAt,
  }));
}

/** Count sessions not past their absolute expiry — the "currently active" metric. */
export async function countActiveSessions(deps: MembersDeps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(session)
    .where(sql`${session.expiresAt} > now()`);
  return Number(row?.n ?? 0);
}

// ---- helpers ----

async function countOtherAdmins(db: Db, exceptMemberId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.role, 'team_admin'), ne(member.id, exceptMemberId)));
  return count;
}

function isAdminRole(row: { role?: string; isAdmin?: boolean }): boolean {
  if (typeof row.isAdmin === 'boolean') return row.isAdmin;
  return row.role === 'team_admin' || row.role === 'org_admin';
}

/** Detect a Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}
