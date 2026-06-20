import type { Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import { parseAuditEnvelope, nextPassNo } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handlePlanAudit(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const parsed = parseAuditEnvelope(envelope);
  if (parsed.kind === 'missing_report') {
    throw new Error(`Plan audit returned no structured report: ${parsed.headline}`);
  }

  const passNo = await nextPassNo(db, ctx.projectId, 'plan');
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';

  await db.insert(auditPass).values({
    projectId: ctx.projectId,
    scope: 'plan',
    passNo,
    findingsCount: parsed.findings.length,
    verdict,
    mmaBatchId: ctx.batchRowId,
  });

  if (ctx.actorId) {
    await logAction(
      { projectId: ctx.projectId, memberId: ctx.actorId, action: 'audit', target: `plan-pass:${passNo}` },
      db,
    );
  }
}

registerHandler('plan-audit', handlePlanAudit);
