import type { Db } from '@/db/client';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { replaceTaskSection } from '@/plan/plan-file-ops';

function parseDraftMd(raw: string): string | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;
  const codeBlock = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlock) cleaned = codeBlock[1].trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.draftMd === 'string') return parsed.draftMd;
  } catch { /* not JSON */ }
  // Accept any non-trivial content as the revised task body
  if (cleaned.length > 20) return cleaned;
  return null;
}

async function handlePlanAuditApply(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const draftMd = parseDraftMd(raw);
  if (!draftMd) throw new Error('Response missing draftMd — could not parse revised task body');

  const request = ctx.request as { taskTitle?: string };
  if (!request.taskTitle) throw new Error('No taskTitle in request meta');

  await replaceTaskSection(ctx.projectId, request.taskTitle, draftMd);
}

registerHandler('plan-audit-apply', handlePlanAuditApply);
