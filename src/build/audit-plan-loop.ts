import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';

/**
 * Plan-audit queries — pass history for the Plan stage UI. The dispatch path
 * is async via `dispatchMma` → `plan-audit` handler. Reuses
 * `parseAuditEnvelope` + `nextPassNo` from `spec/audit-loop`.
 */

/** The full plan audit-pass history for a project, oldest-first. */
export async function planAuditHistory(db: Db, projectId: string) {
  const dbi = db ?? getDb();
  return dbi
    .select({
      passNo: auditPass.passNo,
      findingsCount: auditPass.findingsCount,
      verdict: auditPass.verdict,
      createdAt: auditPass.createdAt,
    })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'plan')))
    .orderBy(asc(auditPass.passNo));
}
