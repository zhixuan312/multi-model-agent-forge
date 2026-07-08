import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * The authoritative `is_admin` gate (Node runtime). Edge middleware only path-
 * gates by authentication — it cannot read `member.is_admin` (a DB fact). Every
 * admin RSC page + handler calls this; non-admins get 403 (API) / redirect (page).
 */

/** Thrown by `requireAdminMember` when the caller is not an admin. Handlers map
 *  this to a 403; pages should use `requireAdminPage` (which redirects). */
export class NotAdminError extends Error {
  readonly status = 403;
  constructor() {
    super('Admin privileges required.');
    this.name = 'NotAdminError';
  }
}

export class NotAuthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super('Authentication required.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Pure predicate — the testable core of the gate. Asserts the member is present
 * and has org_admin or team_admin role. Throws `NotAuthenticatedError` / `NotAdminError` otherwise.
 */
export function assertAdmin(member: AuthedMember | null): AuthedMember {
  if (!member) throw new NotAuthenticatedError();
  if (member.role !== 'org_admin' && member.role !== 'team_admin') throw new NotAdminError();
  return member;
}

/** For route handlers: resolve the member and assert admin (throws on failure,
 *  caller maps to 401/403). */
export async function requireAdminMember(): Promise<AuthedMember> {
  return assertAdmin(await currentMember());
}

/** For RSC pages: resolve the member; redirect to `/login` if unauthenticated,
 *  to `/` if authenticated-but-not-admin. */
export async function requireAdminPage(): Promise<AuthedMember> {
  const member = await currentMember();
  if (!member) redirect('/login');
  if (member.role !== 'org_admin' && member.role !== 'team_admin') redirect('/');
  return member;
}

/**
 * For team-scoped RSC pages (projects, loops, journal, workspace): resolve the
 * member; redirect to `/login` if unauthenticated, and to `/usage` if the caller
 * has no team (the org admin, who owns shared infra but no team content).
 * Returns the member with a guaranteed non-null `teamId`.
 */
export async function requireTeamPage(): Promise<AuthedMember & { teamId: string }> {
  const member = await currentMember();
  if (!member) redirect('/login');
  if (member.role === 'org_admin' || !member.teamId) redirect('/usage');
  return member as AuthedMember & { teamId: string };
}
