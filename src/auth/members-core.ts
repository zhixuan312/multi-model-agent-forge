import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
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
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

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
}

/**
 * Create a member + exactly one `local` identity (argon2id hash). Username
 * uniqueness is case-insensitive — pre-checked against `lower(username)` AND
 * guarded by the `member_username_lower_uniq` functional unique index, so a
 * race that slips past the pre-check still surfaces as `duplicate_username`.
 */
export async function createMember(
  input: unknown,
  deps: MembersDeps = {},
): Promise<CreateMemberResult> {
  const db = deps.db ?? getDb();
  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { displayName, username, password } = parsed.data;

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
        .values({ username, displayName, isAdmin: false })
        .returning({
          id: member.id,
          username: member.username,
          displayName: member.displayName,
          avatarTint: member.avatarTint,
          isAdmin: member.isAdmin,
        });
      // Exactly one local identity per member (the one-local-identity rule).
      await tx.insert(memberIdentity).values({
        memberId: m.id,
        provider: 'local',
        passwordHash,
      });
      return m;
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
    .select({ id: member.id, isAdmin: member.isAdmin })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  if (!target) return { kind: 'not_found' };

  // Last-admin guard: demoting the only remaining admin would lock out the team.
  if (target.isAdmin && !nextIsAdmin) {
    const others = await countOtherAdmins(db, memberId);
    if (others === 0) return { kind: 'last_admin' };
  }

  await db.update(member).set({ isAdmin: nextIsAdmin }).where(eq(member.id, memberId));
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
    .where(and(eq(memberIdentity.memberId, memberId), eq(memberIdentity.provider, 'local')))
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

  const [target] = await db
    .select({ id: member.id, isAdmin: member.isAdmin })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  if (!target) return { kind: 'not_found' };

  if (target.isAdmin) {
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
  return db
    .select({
      id: member.id,
      username: member.username,
      displayName: member.displayName,
      avatarTint: member.avatarTint,
      isAdmin: member.isAdmin,
      createdAt: member.createdAt,
    })
    .from(member)
    .orderBy(member.createdAt);
}

// ---- helpers ----

async function countOtherAdmins(db: Db, exceptMemberId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.isAdmin, true), ne(member.id, exceptMemberId)));
  return count;
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
