import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { member } from '@/db/schema/identity';

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
