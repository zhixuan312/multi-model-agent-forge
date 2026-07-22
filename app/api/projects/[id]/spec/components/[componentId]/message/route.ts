import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { guardSpecWrite } from '@/spec/handler-guard';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;
  // CSRF + auth + tenant scope (project must belong to the caller's team) — without
  // assertProjectReadable this route let any authed member post into another team's spec chat.
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { bodyMd?: unknown };
  const bodyMd = typeof body.bodyMd === 'string' ? body.bodyMd : '';
  if (!bodyMd.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

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
