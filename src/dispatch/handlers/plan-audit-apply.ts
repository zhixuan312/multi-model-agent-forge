import type { Db } from '@/db/client';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { replaceTaskSection } from '@/plan/plan-file-ops';

async function handlePlanAuditApply(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const parsed = JSON.parse(raw) as { draftMd?: string };
  if (typeof parsed.draftMd !== 'string') throw new Error('Response missing draftMd');

  const request = ctx.request as { taskTitle?: string };
  if (!request.taskTitle) throw new Error('No taskTitle in request meta');

  await replaceTaskSection(ctx.projectId, request.taskTitle, parsed.draftMd);
}

registerHandler('plan-audit-apply', handlePlanAuditApply);
