import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';

/**
 * Shared guard for the team-level journal routes (Spec 6). The journal is
 * team-level (not project-scoped), so there is NO membership/visibility check —
 * any authenticated member may view or recall. For the money-spending recall
 * POST this enforces CSRF first (same-origin), then auth. Returns an error
 * `NextResponse` or the resolved `{ memberId }`.
 *
 * `checkCsrf` is false for read-only GETs (a GET is never a state change).
 */
export interface JournalActor {
  memberId: string;
}

export async function guardJournal(
  req: NextRequest,
  opts: { checkCsrf: boolean },
): Promise<NextResponse | JournalActor> {
  if (opts.checkCsrf) {
    const csrf = rejectCrossOrigin(req);
    if (csrf) return csrf;
  }
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { memberId: me.id };
}
