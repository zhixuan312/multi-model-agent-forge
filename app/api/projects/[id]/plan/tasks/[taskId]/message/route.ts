import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { guardProjectWrite } from '@/auth/guard-project-write';
import { projectEventBus } from '@/sse/event-bus';
import { parseQaMessageBody, QA_MESSAGE_MAX_CHARS } from '@/spec/qa-message-body';
import { notifyMentions } from '@/collab/notify-mentions';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  // CSRF + auth + tenant scope — same IDOR class as the spec message route.
  const guard = await guardProjectWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { bodyMd?: unknown };
  // Length-bounded, not just non-empty: this went into a `text` column and out over SSE
  // to every connected client with no ceiling at all.
  const bodyMd = parseQaMessageBody(body.bodyMd);
  if (bodyMd === null) {
    return NextResponse.json(
      { error: `A message must be between 1 and ${QA_MESSAGE_MAX_CHARS} characters.` },
      { status: 400 },
    );
  }

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
      bodyMd,
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
      bodyMd,
    },
  });

  // The @-mention autocomplete used to be decorative — it completed a teammate's name and
  // then nothing happened. Notify each person actually named. After the publish, because a
  // message that is already committed must not fail on the fan-out.
  await notifyMentions(db, {
    projectId: id,
    messageId: row.id,
    bodyMd,
    authorId: me.id,
    authorName: me.displayName,
    teamId: me.teamId,
    where: 'Plan · Refine',
  });

  return NextResponse.json({ id: row.id });
}
