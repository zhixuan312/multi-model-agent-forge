import { NextRequest, NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { createTeam } from '@/auth/teams-core';
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
  const result = await createTeam(json, { db: getDb() });

  return result.kind === 'invalid'
    ? NextResponse.json({ error: 'Invalid team fields.' }, { status: 400 })
    : NextResponse.json(result.team, { status: 201 });
}
