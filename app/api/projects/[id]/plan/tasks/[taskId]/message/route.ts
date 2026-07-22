import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { guardSpecWrite } from '@/spec/handler-guard';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  // CSRF + auth + tenant scope — same IDOR class as the spec message route.
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { bodyMd?: unknown };
  const bodyMd = typeof body.bodyMd === 'string' ? body.bodyMd : '';
  if (!bodyMd.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  const db = getDb();

  // Single-statement seq (see the spec message route) — avoids the concurrent SELECT-max/INSERT
  // collision.
  const [row] = await db
    .insert(qaMessage)
    .values({
      targetId: taskId,
      projectId: id,
      targetKind: 'plan_task',
      seq: sql<number>`(select coalesce(max(${qaMessage.seq}), 0) + 1 from ${qaMessage} where ${qaMessage.targetId} = ${taskId})`,
      bodyMd: bodyMd.trim(),
      authorId: me.id,
    })
    .returning({ id: qaMessage.id });

  projectEventBus.publish(id, {
    type: 'chat.message',
    scope: 'plan_task',
    targetId: taskId,
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
