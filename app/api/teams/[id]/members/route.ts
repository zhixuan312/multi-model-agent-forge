import { NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { listMembers } from '@/auth/members-core';
import { getDb } from '@/db/client';

export const runtime = 'nodejs';

/**
 * List one team's roster for the org-admin assign-admin picker (Spec 2 §Teams).
 * Org-admin only. Returns only id / displayName / username / isAdmin — never
 * avatar or credential detail.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const me = await currentMember();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    assertOrgAdmin(me);
  } catch {
    return NextResponse.json({ error: 'Org admin privileges required.' }, { status: 403 });
  }

  const { id } = await params;
  const members = await listMembers({ db: getDb(), teamId: id });
  return NextResponse.json(
    members.map((m) => ({ id: m.id, displayName: m.displayName, username: m.username, isAdmin: m.isAdmin })),
  );
}
