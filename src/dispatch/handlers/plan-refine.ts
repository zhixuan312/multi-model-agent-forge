import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { qaMessage } from '@/db/schema/spec';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parsePlanRefineResponse } from '@/plan/plan-refine-prompt';
import { replaceTaskSection } from '@/plan/plan-file-ops';

async function handlePlanRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parsePlanRefineResponse(raw);
  const request = ctx.request as { taskId: string };

  if (result.updatedTaskBody) {
    const [task] = await db
      .select({ title: planTask.title })
      .from(planTask)
      .where(eq(planTask.id, request.taskId))
      .limit(1);

    if (task) {
      await replaceTaskSection(ctx.projectId, task.title, result.updatedTaskBody);
    }
  }

  const forgeReply = result.chatReply || 'Updated the task.';
  const [seqRow] = await db
    .select({ max: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, request.taskId));

  const [msgRow] = await db.insert(qaMessage).values({
    componentId: request.taskId,
    seq: (seqRow?.max ?? -1) + 1,
    sender: 'forge',
    bodyMd: forgeReply,
    meta: { taskUpdated: !!result.updatedTaskBody },
  }).returning({ id: qaMessage.id });

  const { projectEventBus } = await import('@/sse/event-bus');
  projectEventBus.publish(ctx.projectId, {
    type: 'chat.message',
    componentId: request.taskId,
    message: {
      id: msgRow.id,
      sender: 'forge',
      authorId: 'forge',
      authorName: 'Forge',
      bodyMd: forgeReply,
    },
  });
}

registerHandler('plan-refine', handlePlanRefine);
