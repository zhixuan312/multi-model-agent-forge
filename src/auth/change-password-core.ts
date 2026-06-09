import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { memberIdentity } from '@/db/schema/identity';
import { hashPassword, verifyPassword, passwordSchema } from '@/auth/password';
import { sessionStore, type SessionStore } from '@/auth/session-store';

/**
 * Own-account change-password core (Spec 1 §Change-password / F11, F19).
 *
 * 1. Validate the new password (≥ PASSWORD_MIN_LENGTH).
 * 2. Verify the current password against the `local` identity (argon2id).
 * 3. Set the new hash AND bump `password_changed_at = now()` — sourced from the
 *    DATABASE clock (single-clock-source rule, F19), not JS time.
 * 4. The bump invalidates every existing session (all > created_at). AFTER the
 *    bump commits, re-issue a fresh session for the CALLING device so the user
 *    stays logged in here, and revoke all OTHER sessions.
 */

export type ChangePasswordResult =
  | { kind: 'invalid_new_password' }
  | { kind: 'wrong_current_password' }
  | { kind: 'no_identity' }
  | { kind: 'success'; token: string };

export interface ChangePasswordDeps {
  db?: Db;
  store?: SessionStore;
}

export async function changeOwnPassword(
  input: { memberId: string; currentPassword: string; newPassword: string; currentSessionId?: string },
  deps: ChangePasswordDeps = {},
): Promise<ChangePasswordResult> {
  const db = deps.db ?? getDb();
  const store = deps.store ?? sessionStore;

  if (!passwordSchema.safeParse(input.newPassword).success) {
    return { kind: 'invalid_new_password' };
  }

  const [identity] = await db
    .select({ id: memberIdentity.id, passwordHash: memberIdentity.passwordHash })
    .from(memberIdentity)
    .where(and(eq(memberIdentity.memberId, input.memberId), eq(memberIdentity.provider, 'local')))
    .limit(1);

  if (!identity || !identity.passwordHash) return { kind: 'no_identity' };

  const ok = await verifyPassword(input.currentPassword, identity.passwordHash);
  if (!ok) return { kind: 'wrong_current_password' };

  const newHash = await hashPassword(input.newPassword);
  // password_changed_at = DB clock (now()), not JS Date — F19 single-clock rule.
  await db
    .update(memberIdentity)
    .set({ passwordHash: newHash, passwordChangedAt: sql`now()` })
    .where(eq(memberIdentity.id, identity.id));

  // AFTER the bump commits: re-issue a fresh session for the caller (its
  // created_at, DB clock, is now AFTER password_changed_at) so it stays valid,
  // then drop every OTHER session for this member (including the caller's old one).
  const reissued = await store.create(input.memberId);
  await store.revokeAllForMemberExcept(input.memberId, reissued.record.id);

  return { kind: 'success', token: reissued.token };
}
