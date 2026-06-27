import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parsePlanRefineResponse } from '@/plan/plan-refine-prompt';

async function handlePlanRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parsePlanRefineResponse(raw);
  const request = ctx.request as { taskId: string };

  if (result.updatedTaskBody) {
    await db
      .update(planTask)
      .set({ detail: result.updatedTaskBody, updatedAt: new Date() })
      .where(eq(planTask.id, request.taskId));
  }
}

registerHandler('plan-refine', handlePlanRefine);
