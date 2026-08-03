import type { Db } from '@/db/client';
import { parseAuditEnvelope, nextPassNo } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';
import { projectEventBus } from '@/sse/event-bus';
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

  // Same reason spec-audit publishes `spec.updated`: an auto-driven audit is dispatched
  // server-side, so the client's onDone tracking never fires and the Validate rail would
  // show nothing until a manual reload. The spec side had this; the plan side did not.
  projectEventBus.publish(ctx.projectId, { type: 'plan.stage_updated' });
}

registerHandler('plan-audit', handlePlanAudit);
