import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, ne } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { currentMember } from '@/auth/current-member';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const now = new Date();
  await db
    .update(project)
    .set({ phase: 'completed', completedAt: now, updatedAt: now })
    .where(eq(project.id, id));
  await db
    .update(stage)
    .set({ status: 'done', completedAt: now })
    .where(and(eq(stage.projectId, id), ne(stage.status, 'done')));

  return NextResponse.json({ ok: true });
}
