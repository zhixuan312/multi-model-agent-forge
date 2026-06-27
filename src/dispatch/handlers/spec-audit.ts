import { desc, and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import { parseAuditEnvelope, nextPassNo } from '@/spec/audit-loop';
import type { AuditVerdict } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleSpecAudit(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const [existing] = await db
    .select({ id: auditPass.id })
    .from(auditPass)
    .where(eq(auditPass.mmaBatchId, ctx.batchRowId))
    .limit(1);
  if (existing) return;

  const parsed = parseAuditEnvelope(envelope);
  if (parsed.kind === 'missing_report') {
    throw new Error('Audit returned no structured report');
  }

  const passNo = await nextPassNo(db, ctx.projectId);
  const verdict: AuditVerdict = parsed.hasCriticalOrHigh ? 'revised' : 'clean';

  await db.insert(auditPass).values({
    projectId: ctx.projectId,
    scope: 'spec',
    passNo,
    findingsCount: parsed.findings.length,
    verdict,
    mmaBatchId: ctx.batchRowId,
    contextBlockId: parsed.contextBlockId,
  });

  if (ctx.actorId) {
    await logAction(
      { projectId: ctx.projectId, memberId: ctx.actorId, action: 'audit', target: `pass:${passNo}` },
      db,
    );
  }
}

registerHandler('spec-audit', handleSpecAudit);
