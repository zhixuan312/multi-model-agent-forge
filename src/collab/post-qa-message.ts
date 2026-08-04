import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { guardProjectWrite } from '@/auth/guard-project-write';
import { projectEventBus } from '@/sse/event-bus';
import { parseQaMessageBody, QA_MESSAGE_MAX_CHARS } from '@/spec/qa-message-body';
import { notifyMentions } from '@/collab/notify-mentions';
import type { QaTargetKind } from '@/db/enums';

/**
 * Post one discussion message: guard → validate → insert → publish → notify.
 *
 * ONE implementation. The Spec-component and Plan-task message routes were byte-identical
 * apart from three values (the target id, the `targetKind`, and the breadcrumb a
 * notification links to) and their comments — two copies of a chain that has to stay in
 * step across auth, a length ceiling, a concurrency-safe `seq`, an SSE frame and a
 * notification fan-out.
 *
 * `mention-routes-notify.test.ts` already recorded the risk in its own docstring — "the two
 * message routes are near-copies of each other, so a third one added by copying either
 * would inherit whichever was missed" — and guarded the symptom with a source check rather
 * than removing the cause. Each of the five steps below is one that was, at some point,
 * missing from one copy:
 *
 *  - **Guard.** Without `guardProjectWrite` this route let any authed member post into
 *    another team's chat (the same IDOR class both routes carried).
 *  - **Length.** `parseQaMessageBody` bounds the body. It previously went into a `text`
 *    column and back out over SSE to every connected client with no ceiling at all.
 *  - **`seq` in ONE statement.** A separate SELECT-max then INSERT is two round-trips, and
 *    concurrent messages read the same max and collide.
 *  - **Publish before notify.** The message is already committed; the fan-out must not be
 *    able to fail it.
 *  - **Notify.** The @-mention autocomplete completed a teammate's name and then did
 *    nothing at all until this call existed.
 */
export async function postQaMessage(
  req: NextRequest,
  opts: {
    projectId: string;
    /** The row the thread hangs off — a spec component id or a plan task id. */
    targetId: string;
    targetKind: QaTargetKind;
    /** Where a notified reader will land, e.g. `Spec · Craft`. */
    where: string;
  },
): Promise<NextResponse> {
  const { projectId, targetId, targetKind, where } = opts;

  const guard = await guardProjectWrite(req, projectId);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { bodyMd?: unknown };
  const bodyMd = parseQaMessageBody(body.bodyMd);
  if (bodyMd === null) {
    return NextResponse.json(
      { error: `A message must be between 1 and ${QA_MESSAGE_MAX_CHARS} characters.` },
      { status: 400 },
    );
  }

  const db = getDb();

  const [row] = await db
    .insert(qaMessage)
    .values({
      targetId,
      projectId,
      targetKind,
      seq: sql<number>`(select coalesce(max(${qaMessage.seq}), 0) + 1 from ${qaMessage} where ${qaMessage.targetId} = ${targetId})`,
      bodyMd,
      authorId: me.id,
    })
    .returning({ id: qaMessage.id });

  projectEventBus.publish(projectId, {
    type: 'chat.message',
    scope: targetKind,
    targetId,
    message: {
      id: row.id,
      sender: 'member',
      authorId: me.id,
      authorName: me.displayName,
      bodyMd,
    },
  });

  await notifyMentions(db, {
    projectId,
    messageId: row.id,
    bodyMd,
    authorId: me.id,
    authorName: me.displayName,
    teamId: me.teamId,
    where,
  });

  return NextResponse.json({ id: row.id });
}
