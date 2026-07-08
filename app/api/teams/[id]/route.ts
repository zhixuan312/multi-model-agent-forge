import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { assertOrgAdmin } from '@/auth/team-scope';
import { getDb } from '@/db/client';
import { team } from '@/db/schema/team';

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
  const db = getDb();

  const patch: Record<string, unknown> = {};
  if (typeof json?.name === 'string') patch.name = json.name;
  if (typeof json?.slug === 'string') patch.slug = json.slug;
  if (typeof json?.workspaceRootPath === 'string') patch.workspaceRootPath = json.workspaceRootPath;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  }

  await db.update(team).set({ ...patch, updatedAt: new Date() }).where(eq(team.id, teamId));
  const [updated] = await db.select().from(team).where(eq(team.id, teamId)).limit(1);

  return NextResponse.json(updated);
}
