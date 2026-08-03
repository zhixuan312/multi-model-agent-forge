/**
 * The Forge system member — a real team_member row with a fixed UUID,
 * no team_identity (non-loginable by humans). Used as the actorId
 * for all server-side automation actions.
 */

export const FORGE_MEMBER_ID = '00000000-0000-0000-0000-000000000000';

export function isForgeSystemMember(memberId: string): boolean {
  return memberId === FORGE_MEMBER_ID;
}

/**
 * Forge's display identity.
 *
 * The name and tint were written out inline in a dozen places — six copies of
 * `{ id: FORGE_MEMBER_ID, name: 'Forge', tint: '#9a6b4f' }` on the server, plus a
 * `MemberRef` in each of the Spec and Plan stages. The Plan one had drifted to `#8B6914`,
 * so Forge wore a different colour in the plan mention list than in Spec or the activity
 * feed. This module already owns Forge's id; it owns the rest of its identity now.
 */
export const FORGE_DISPLAY_NAME = 'Forge';

/** Happens to equal the DB default avatar tint, but means "Forge's colour", not "no colour". */
export const FORGE_AVATAR_TINT = '#9a6b4f';

/** The actor shape `recordActivity` takes, for a server-side action Forge performed. */
export const FORGE_ACTOR = {
  id: FORGE_MEMBER_ID,
  name: FORGE_DISPLAY_NAME,
  tint: FORGE_AVATAR_TINT,
} as const;
