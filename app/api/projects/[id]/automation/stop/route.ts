import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { currentMember } from '@/auth/current-member';
import { setAutomationStatus } from '@/details/write';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  await setAutomationStatus(db, id, 'off');
  await db.update(project).set({ autoMode: false, autoNote: 'Stopped by user', updatedAt: new Date() }).where(eq(project.id, id));

  return NextResponse.json({ ok: true });
}
