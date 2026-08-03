import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, forbidden, ORG_ADMIN_REQUIRED } from '@/auth/api-responses';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { assignTeamAdmin } from '@/auth/teams-core';
import { isForgeSystemMember } from '@/automation/forge-member';
import { getDb } from '@/db/client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  // `currentMember()` reads the session and the member row from the DATABASE, so it can
  // throw for reasons that have nothing to do with permission. Inside the try it did, and
  // an outage answered "Org admin required." — telling an org admin they are not one.
  const member = await currentMember();
  if (!member) return unauthorized();
  try {
    assertOrgAdmin(member);
  } catch {
    return forbidden(ORG_ADMIN_REQUIRED);
  }

  const { id: teamId } = await params;
  // `json?.memberId as string` let a number or object through the truthiness check and
  // into a uuid comparison, which Postgres answers with an error — a 500 for a bad body.
  const json = (await req.json().catch(() => null)) as { memberId?: unknown } | null;
  const memberId = typeof json?.memberId === 'string' ? json.memberId.trim() : '';

  if (!memberId) {
    return NextResponse.json({ error: 'memberId required.' }, { status: 400 });
  }
  if (isForgeSystemMember(memberId)) {
    return NextResponse.json({ error: 'The Forge agent cannot be a team admin.' }, { status: 400 });
  }

  const result = await assignTeamAdmin(teamId, memberId, { db: getDb() });

  return result.kind === 'not_found'
    ? NextResponse.json({ error: 'Member not found or not in team.' }, { status: 404 })
    : NextResponse.json({ success: true });
}
