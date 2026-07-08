import { NextRequest, NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { assignTeamAdmin } from '@/auth/teams-core';
import { isForgeSystemMember } from '@/automation/forge-member';
import { getDb } from '@/db/client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const member = await currentMember();
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    assertOrgAdmin(member);
  } catch {
    return NextResponse.json({ error: 'Org admin privileges required.' }, { status: 403 });
  }

  const { id: teamId } = await params;
  const json = await req.json().catch(() => null);
  const memberId = json?.memberId as string;

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
