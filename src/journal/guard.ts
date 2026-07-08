import { NextResponse, type NextRequest } from 'next/server';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { requireTeamScope } from '@/auth/team-scope';

/**
 * Shared guard for the team-level journal routes (Spec 6). The journal is
 * team-level (not project-scoped), so there is NO membership/visibility check —
 * any authenticated member may view or recall. For the money-spending recall
 * POST this enforces CSRF first (same-origin), then auth. Returns an error
 * `NextResponse` or the resolved `{ memberId, team }`.
 *
 * `checkCsrf` is false for read-only GETs (a GET is never a state change).
 */
export interface JournalActor {
  memberId: string;
  team: { id: string; name: string; slug: string; workspaceRootPath: string; gitTokenRef: string | null };
}

export async function guardJournal(
  req: NextRequest,
  opts: { checkCsrf: boolean },
): Promise<NextResponse | JournalActor> {
  if (opts.checkCsrf) {
    const csrf = rejectCrossOrigin(req);
    if (csrf) return csrf;
  }
  try {
    const scope = await requireTeamScope();
    return { memberId: scope.actor.id, team: scope.currentTeam };
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
