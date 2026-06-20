import type { Db } from '@/db/client';
import { PlanDraftSchema } from '@/build/plan-schema';
import { authorPlan } from '@/build/plan-author';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';


async function handlePlanAuthor(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const parsed = JSON.parse(raw);
  const draft = PlanDraftSchema.parse(Array.isArray(parsed) ? { tasks: parsed } : parsed);
  const request = ctx.request as { actorId?: string };

  const result = await authorPlan(
    { db, draftOverride: draft },
    { projectId: ctx.projectId, actorId: request.actorId ?? 'system' },
  );

  if (!result.ok) {
    throw new Error(result.reason);
  }
}

registerHandler('plan-author', handlePlanAuthor);
