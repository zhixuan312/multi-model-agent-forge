import type { Db } from '@/db/client';
import { parseAuditEnvelope, nextPassNo } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';
import { recordAuditPass } from '@/automation/details-mutations';

export async function handlePlanAudit(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const parsed = parseAuditEnvelope(envelope);
  if (parsed.kind === 'missing_report') {
    throw new Error('Plan audit returned no structured report');
  }

  const passNo = await nextPassNo(db, ctx.projectId, 'plan');
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';

  await updateDetails(db, ctx.projectId, (d) =>
    recordAuditPass(d, 'plan', passNo, verdict, ctx.batchRowId, new Date().toISOString(), parsed.contextBlockId),
  );
}

registerHandler('plan-audit', handlePlanAudit);
