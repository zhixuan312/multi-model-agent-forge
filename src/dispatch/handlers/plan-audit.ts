import type { Db } from '@/db/client';
import { parseAuditEnvelope, nextPassNo } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';

async function handlePlanAudit(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const parsed = parseAuditEnvelope(envelope);
  if (parsed.kind === 'missing_report') {
    throw new Error('Plan audit returned no structured report');
  }

  const passNo = await nextPassNo(db, ctx.projectId, 'plan');
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';

  await updateDetails(db, ctx.projectId, (d) => {
    d.stages.plan.phases.validate.auditPasses.push({
      passNo,
      status: verdict,
      audit: { attempts: [{ batchId: ctx.batchRowId, status: 'done', at: new Date().toISOString() }] },
    });
    return d;
  });

  if (ctx.actorId) {
    await logAction(
      { projectId: ctx.projectId, memberId: ctx.actorId, action: 'audit', target: `plan-pass:${passNo}` },
      db,
    );
  }
}

registerHandler('plan-audit', handlePlanAudit);
