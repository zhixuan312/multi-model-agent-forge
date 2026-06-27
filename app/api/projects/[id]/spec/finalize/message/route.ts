import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { stage } from '@/db/schema/projects';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bodyMd } = (await req.json()) as { bodyMd: string };
  if (!bodyMd?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  const db = getDb();

  const [stageRow] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);
  if (!stageRow) return NextResponse.json({ error: 'Stage not found' }, { status: 404 });

  const [seqRow] = await db
    .select({ max: sql<number>`coalesce(max(${qaMessage.seq}), 0)` })
    .from(qaMessage)
    .where(and(eq(qaMessage.stageId, stageRow.id), isNull(qaMessage.componentId)));

  const [row] = await db
    .insert(qaMessage)
    .values({
      stageId: stageRow.id,
      componentId: null,
      seq: (seqRow?.max ?? 0) + 1,
      sender: 'member',
      bodyMd: bodyMd.trim(),
      authorId: me.id,
    })
    .returning({ id: qaMessage.id });

  projectEventBus.publish(id, {
    type: 'chat.message',
    componentId: `finalize:${stageRow.id}`,
    message: {
      id: row.id,
      sender: 'member',
      authorId: me.id,
      authorName: me.displayName,
      bodyMd: bodyMd.trim(),
    },
  });

  return NextResponse.json({ id: row.id });
}
