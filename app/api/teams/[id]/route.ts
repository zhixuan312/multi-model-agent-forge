import { NextRequest, NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { updateTeam } from '@/auth/teams-core';
import { getDb } from '@/db/client';

export const runtime = 'nodejs';

/**
 * Edit an existing team (org-admin only): name / slug / workspace root. Only the
 * fields provided change; a new workspace path is validated against the operator
 * base (FR-8) before it is stored.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const member = await currentMember();
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    assertOrgAdmin(member);
  } catch {
    return NextResponse.json({ error: 'Org admin privileges required.' }, { status: 403 });
  }

  const { id: teamId } = await params;
  const json = await req.json().catch(() => null);
  const result = await updateTeam(json, { teamId, db: getDb() });

  return result.kind === 'invalid'
    ? NextResponse.json({ error: result.reason }, { status: 400 })
    : NextResponse.json({ ok: true });
}
