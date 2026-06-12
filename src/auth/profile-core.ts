import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { member, session } from '@/db/schema/identity';

/**
 * Own-profile account update (Spec 1 §Profile / F10, F23). A member edits their
 * own `display_name` and `avatar_tint`; `username` is the local-auth login key
 * and is NOT editable in Spec 1 (no field here for it). DI-testable; the route
 * (`/api/profile`) is a thin shell over this.
 */

const HEX_TINT = /^#[0-9a-fA-F]{6}$/;

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1),
  avatarTint: z.string().regex(HEX_TINT),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export type UpdateProfileResult =
  | { kind: 'updated'; displayName: string; avatarTint: string }
  | { kind: 'invalid' }
  | { kind: 'not_found' };

export async function updateOwnProfile(
  memberId: string,
  input: unknown,
  deps: { db?: Db } = {},
): Promise<UpdateProfileResult> {
  const db = deps.db ?? getDb();
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };

  const [updated] = await db
    .update(member)
    .set({ displayName: parsed.data.displayName, avatarTint: parsed.data.avatarTint })
    .where(eq(member.id, memberId))
    .returning({ displayName: member.displayName, avatarTint: member.avatarTint });

  if (!updated) return { kind: 'not_found' };
  return { kind: 'updated', displayName: updated.displayName, avatarTint: updated.avatarTint };
}

/** Read-only profile facts for the Profile status row (member-since + own active sessions). */
export interface ProfileMeta {
  createdAt: Date | null;
  activeSessions: number;
}

export async function getProfileMeta(memberId: string, deps: { db?: Db } = {}): Promise<ProfileMeta> {
  const db = deps.db ?? getDb();
  const [m] = await db
    .select({ createdAt: member.createdAt })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  const [s] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(session)
    .where(and(eq(session.memberId, memberId), sql`${session.expiresAt} > now()`));
  return { createdAt: m?.createdAt ?? null, activeSessions: Number(s?.n ?? 0) };
}
