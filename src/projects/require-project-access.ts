import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { assertProjectReadable, ProjectAccessError, type ProjectActor } from '@/projects/projects-core';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * The project access gate, as ONE function.
 *
 * Every project surface must answer the same three questions before it reads anything:
 * is there a session, does that member map to a project actor, and may that actor see
 * THIS project. The six stage pages and the project layout each spelled the answer out —
 * seven byte-identical copies of a security check, which is seven places to get right
 * and one place to quietly get wrong.
 *
 * Redirects for "not signed in" / "no actor", and `notFound()` for "not yours" — never a
 * 403, so an unreadable project is indistinguishable from a missing one.
 *
 * Its own module rather than part of `projects-core`: that module is data access, and
 * this one reaches for `next/navigation`. Keeping them apart also preserves the
 * `assertProjectReadable` seam — a caller inside projects-core would bypass the module
 * mock that the layout test relies on.
 */
export async function requireProjectAccess(
  projectId: string,
): Promise<{ me: AuthedMember; actor: ProjectActor }> {
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  if (!actor) redirect('/');

  try {
    await assertProjectReadable(projectId, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }
  return { me, actor };
}
