import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, forbidden, ORG_ADMIN_REQUIRED } from '@/auth/api-responses';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { createTeamWithAdmin } from '@/auth/teams-core';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';

export async function GET(): Promise<NextResponse> {
  // The try used to wrap the whole handler, INCLUDING the team query — so any failure
  // listing teams answered "Org admin required." The catch belongs around the permission
  // assertion and nothing else.
  const member = await currentMember();
  if (!member) return unauthorized();
  try {
    assertOrgAdmin(member);
  } catch {
    return forbidden(ORG_ADMIN_REQUIRED);
  }

  const teams = await getDb().select().from(team);
  return NextResponse.json(teams);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const json = await req.json().catch(() => null);
  const result = await createTeamWithAdmin(json, { db: getDb() });

  if (result.kind === 'invalid') {
    return NextResponse.json({ error: 'Invalid team or admin fields.' }, { status: 400 });
  }
  if (result.kind === 'duplicate_username') {
    return NextResponse.json({ error: 'That admin username is already taken.' }, { status: 409 });
  }
  return NextResponse.json({ ...result.team, admin: result.admin }, { status: 201 });
}
