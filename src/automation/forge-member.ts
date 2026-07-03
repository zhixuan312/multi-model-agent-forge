/**
 * The Forge system member — a real team_member row with a fixed UUID,
 * no team_identity (non-loginable by humans). Used as the actorId
 * for all server-side automation actions.
 */

export const FORGE_MEMBER_ID = '00000000-0000-0000-0000-000000000000';

export function isForgeSystemMember(memberId: string): boolean {
  return memberId === FORGE_MEMBER_ID;
}
