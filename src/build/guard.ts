import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';

/**
 * Shared guard for every Spec-7 build write handler: CSRF → auth → membership.
 * Mirrors `guardExploreWrite` (Spec 5) / `guardSpecWrite` (Spec 4). Returns an
 * error `NextResponse` or the resolved `{ memberId }`.
 */
export interface GuardedActor {
  memberId: string;
}

export async function guardBuildWrite(
  req: NextRequest,
  projectId: string,
): Promise<NextResponse | GuardedActor> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertProjectReadable(projectId, { id: me.id, teamId: me.teamId! });
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw e;
  }
  return { memberId: me.id };
}
