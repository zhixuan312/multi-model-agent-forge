import { NextResponse, type NextRequest } from 'next/server';
import { unauthorized } from '@/auth/api-responses';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import type { AuthedMember } from '@/auth/auth-provider';
import { projectActorFromMember } from '@/auth/team-scope';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';

/**
 * The single guard for every project write handler: CSRF → auth → membership, plus an
 * optional phase check.
 *
 * There used to be three of these — `guardSpecWrite` (spec), `guardExploreWrite`
 * (explore) and `guardBuildWrite` (build). The latter two were byte-for-byte identical,
 * and the first was the same thing plus the optional phase check, each shipping its own
 * `GuardedActor` interface. Three copies of a SECURITY guard means a correction to the
 * CSRF/auth ordering has to be made — and remembered — in three places.
 *
 * The duplication had already produced a visible inconsistency: under
 * `plan/tasks/[taskId]/`, `refine` guarded with the build variant while its siblings
 * `message` and `invite` used the spec one, so adjacent routes on the same resource were
 * protected by different (if equivalent) code.
 *
 * Returns an error `NextResponse` to hand straight back, or the resolved actor.
 */
export interface GuardedActor {
  /** The convenience accessor most callers use. */
  memberId: string;
  /** The full authed member (displayName/tint) for routes that emit SSE or notifications. */
  member: AuthedMember;
}

export async function guardProjectWrite(
  req: NextRequest,
  projectId: string,
  opts: { requireUnfrozen?: boolean } = {},
): Promise<NextResponse | GuardedActor> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return unauthorized();
  const actor = projectActorFromMember(me);
  if (!actor) return unauthorized();

  // Membership predicate (public OR project_member). 403 on a write — the actor
  // already knows the project exists if they reached here, so there is nothing to
  // hide behind the read path's anti-enumeration 404.
  try {
    await assertProjectReadable(projectId, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw e;
  }

  if (opts.requireUnfrozen) {
    const [row] = await getDb()
      .select({ phase: project.phase })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (row.phase !== 'design') {
      return NextResponse.json({ error: 'Spec is locked — read-only.' }, { status: 409 });
    }
  }

  return { memberId: me.id, member: me };
}
