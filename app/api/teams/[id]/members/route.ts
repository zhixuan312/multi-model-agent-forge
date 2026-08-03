import { NextResponse } from 'next/server';
import { unauthorized, forbidden, ORG_ADMIN_REQUIRED } from '@/auth/api-responses';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { listMembers } from '@/auth/members-core';
import { isForgeSystemMember } from '@/automation/forge-member';
import { getDb } from '@/db/client';

export const runtime = 'nodejs';

/**
 * List one team's roster for the org-admin assign-admin picker (Spec 2 §Teams).
 * Org-admin only. Returns only id / displayName / username / isAdmin — never
 * avatar or credential detail.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  // `currentMember()` reads the session and the member row from the DATABASE, so it can
  // throw for reasons that have nothing to do with permission. Inside the try it did, and
  // an outage answered "Org admin required." — telling an org admin they are not one.
  const me = await currentMember();
  if (!me) return unauthorized();
  try {
    assertOrgAdmin(me);
  } catch {
    return forbidden(ORG_ADMIN_REQUIRED);
  }

  const { id } = await params;
  const members = await listMembers({ db: getDb(), teamId: id });
  return NextResponse.json(
    members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      username: m.username,
      isAdmin: m.isAdmin,
      // The Forge agent is a non-human system account — not admin-eligible.
      isSystem: isForgeSystemMember(m.id),
    })),
  );
}
