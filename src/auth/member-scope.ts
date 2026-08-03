import type { AuthedMember } from '@/auth/auth-provider';

/**
 * The team filter to apply when an admin acts on a MEMBER.
 *
 * Members are org-owned, so an org_admin is unscoped (`{}`) while a team_admin may only
 * reach their own team. The sentinel matters: a team_admin with no team resolves to
 * `'__no_team__'`, a value no row can hold, so their queries match nothing. Returning `{}`
 * for that case instead would silently promote them to org-wide reach.
 *
 * This lived as a private copy in each of the two member routes. A scoping rule duplicated
 * per route is one route away from a cross-team read.
 */
export function memberScope(actor: AuthedMember): { teamId?: string } {
  return actor.role === 'org_admin' ? {} : { teamId: actor.teamId ?? '__no_team__' };
}
