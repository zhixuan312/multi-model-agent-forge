import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import type { AuthedMember } from '@/auth/auth-provider';
import { projectActorFromMember } from '@/auth/team-scope';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';

/**
 * Shared guard for spec write handlers: CSRF → auth → membership → phase guard.
 * Returns either an error `NextResponse` or the resolved actor. `member` carries
 * the full authed member (displayName/tint) for routes that emit SSE/notifications;
 * `memberId` is the convenience accessor most callers use.
 */
export interface GuardedActor {
  memberId: string;
  member: AuthedMember;
}

export async function guardSpecWrite(
  req: NextRequest,
  projectId: string,
  opts: { requireUnfrozen?: boolean } = {},
): Promise<NextResponse | GuardedActor> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actor = projectActorFromMember(me);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Membership predicate (public OR project_member). 403 on a write (the actor
  // already knows the project exists if they reached here).
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
