import type { Db } from '@/db/client';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { replaceTaskSection } from '@/plan/plan-file-ops';

function parseDraftMd(raw: string): string | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;
  // Try top-level code fence
  const codeBlock = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlock) cleaned = codeBlock[1].trim();
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.draftMd === 'string') return parsed.draftMd;
  } catch { /* not JSON */ }
  // Try to find { "draftMd": "..." } embedded anywhere in the response
  const embedded = cleaned.match(/\{\s*"draftMd"\s*:\s*"([\s\S]*?)"\s*\}\s*$/);
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded[0]);
      if (typeof parsed?.draftMd === 'string') return parsed.draftMd;
    } catch { /* malformed */ }
  }
  // Try code-fenced JSON anywhere in the response
  const fencedJson = cleaned.match(/```json\s*\n([\s\S]*?)\n```/);
  if (fencedJson) {
    try {
      const parsed = JSON.parse(fencedJson[1].trim());
      if (typeof parsed?.draftMd === 'string') return parsed.draftMd;
    } catch { /* malformed */ }
  }
  // Fallback: accept any non-trivial content
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
