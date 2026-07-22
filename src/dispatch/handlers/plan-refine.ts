import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parsePlanRefineResponse } from '@/plan/plan-refine-prompt';
import { replaceTaskSection } from '@/plan/plan-file-ops';

async function handlePlanRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parsePlanRefineResponse(raw);
  const request = ctx.request as { taskId: string };

  if (result.updatedTaskBody) {
    const { project } = await import('@/db/schema/projects');
    const { validateDetails } = await import('@/details/schema');
    const [proj] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
    if (proj?.details) {
      const d = validateDetails(proj.details);
      const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === request.taskId);
      if (task) {
        await replaceTaskSection(ctx.projectId, task.title, result.updatedTaskBody);
      }
    }
  }

  const forgeReply = result.chatReply || 'Updated the task.';

  // seq computed inside the insert (single statement) — avoids the concurrent SELECT-max/INSERT
  // collision (non-unique index → duplicate seq → ambiguous chat ordering).
  const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
  const [msgRow] = await db.insert(qaMessage).values({
    targetId: request.taskId,
    projectId: ctx.projectId,
    targetKind: 'plan_task',
    seq: sql<number>`(select coalesce(max(${qaMessage.seq}), -1) + 1 from ${qaMessage} where ${qaMessage.targetId} = ${request.taskId})`,
    authorId: FORGE_MEMBER_ID,
    bodyMd: forgeReply,
    meta: { taskUpdated: !!result.updatedTaskBody },
  }).returning({ id: qaMessage.id });

  const { projectEventBus } = await import('@/sse/event-bus');
  projectEventBus.publish(ctx.projectId, {
    type: 'chat.message',
    scope: 'plan_task',
    targetId: request.taskId,
    message: {
      id: msgRow.id,
      sender: 'forge',
      authorId: FORGE_MEMBER_ID,
      authorName: 'Forge',
      bodyMd: forgeReply,
    },
  });
}

registerHandler('plan-refine', handlePlanRefine);
