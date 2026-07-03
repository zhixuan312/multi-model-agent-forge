import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { currentMember } from '@/auth/current-member';
import { updateDetails } from '@/details/write';

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

  await updateDetails(db, id, (d) => {
    const nowStr = now.toISOString();
    for (const kind of ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const) {
      if (d.stages[kind].status !== 'done') {
        d.stages[kind].status = 'done';
        d.stages[kind].completedAt = nowStr;
      }
    }
    return d;
  });

  return NextResponse.json({ ok: true });
}
