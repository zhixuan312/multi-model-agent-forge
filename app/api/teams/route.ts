import { NextRequest, NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { createTeamWithAdmin } from '@/auth/teams-core';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';

export async function GET(): Promise<NextResponse> {
  try {
    const member = await currentMember();
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    assertOrgAdmin(member);

    const db = getDb();
    const teams = await db.select().from(team);
    return NextResponse.json(teams);
  } catch {
    return NextResponse.json({ error: 'Org admin privileges required.' }, { status: 403 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const member = await currentMember();
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    assertOrgAdmin(member);
  } catch {
    return NextResponse.json({ error: 'Org admin privileges required.' }, { status: 403 });
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
