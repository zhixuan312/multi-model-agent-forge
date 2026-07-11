import type { Db } from '@/db/client';
import { parseAuditEnvelope, nextPassNo } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';
import { recordAuditPass } from '@/automation/details-mutations';
import { projectEventBus } from '@/sse/event-bus';

export async function handleSpecAudit(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const parsed = parseAuditEnvelope(envelope);
  if (parsed.kind === 'missing_report') {
    throw new Error('Audit returned no structured report');
  }

  const passNo = await nextPassNo(db, ctx.projectId);
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';

  await updateDetails(db, ctx.projectId, (d) =>
    recordAuditPass(d, 'spec', passNo, verdict, ctx.batchRowId, new Date().toISOString(), parsed.contextBlockId),
  );

  if (ctx.actorId) {
    await logAction(
      { projectId: ctx.projectId, memberId: ctx.actorId, action: 'audit', target: `pass:${passNo}` },
      db,
    );
  }

  // Notify subscribed clients so the audit pass appears without a manual refresh.
  // Auto-driven audits are dispatched server-side, so the client's onDone tracking
  // never fires — this SSE event is the only signal the finalize UI gets.
  projectEventBus.publish(ctx.projectId, { type: 'spec.updated' });
}

registerHandler('spec-audit', handleSpecAudit);
