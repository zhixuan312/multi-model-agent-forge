import type { Db } from '@/db/client';
import { PlanDraftSchema } from '@/build/plan-schema';
import { authorPlan } from '@/build/plan-author';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

function extractResponseText(envelope: unknown): string {
  const env = envelope as { structuredReport?: { summary?: string }; results?: Array<{ report?: { reviewer?: { summary?: string } } }> };
  const summary = env?.structuredReport?.summary ?? '';
  if (summary) return summary.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const reviewer = env?.results?.[0]?.report?.reviewer;
  if (reviewer && typeof reviewer === 'object' && 'summary' in reviewer) {
    const rs = (reviewer as { summary?: string }).summary ?? '';
    return rs.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  }
  throw new Error('No parseable response in MMA envelope');
}

async function handlePlanAuthor(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractResponseText(envelope);
  const draft = PlanDraftSchema.parse(JSON.parse(raw));
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
