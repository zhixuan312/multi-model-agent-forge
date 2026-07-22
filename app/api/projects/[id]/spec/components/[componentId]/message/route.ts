import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bodyMd } = (await req.json()) as { bodyMd: string };
  if (!bodyMd?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  const db = getDb();

  // Compute seq INSIDE the insert (single statement) instead of a separate SELECT-max then
  // INSERT — two round-trips let concurrent messages read the same max and collide on seq.
  const [row] = await db
    .insert(qaMessage)
    .values({
      targetId: componentId,
      projectId: id,
      targetKind: 'spec_component',
      seq: sql<number>`(select coalesce(max(${qaMessage.seq}), 0) + 1 from ${qaMessage} where ${qaMessage.targetId} = ${componentId})`,
      bodyMd: bodyMd.trim(),
      authorId: me.id,
    })
    .returning({ id: qaMessage.id });

  projectEventBus.publish(id, {
    type: 'chat.message',
    scope: 'spec_component',
    targetId: componentId,
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
