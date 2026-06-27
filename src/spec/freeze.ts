import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';

/**
 * Freeze gate — the audit-verdict precondition for the spec stage. `canFreeze`
 * returns true iff the latest spec audit pass has verdict 'clean' (no critical
 * or high findings). The actual design→build phase transition happens via
 * `advanceStage` in `projects-core.ts` when plan→execute.
 */

/** True iff the latest spec audit pass verdict is 'clean'. */
export async function canFreeze(db: Db, projectId: string): Promise<boolean> {
  const dbi = db ?? getDb();
  const [latest] = await dbi
    .select({ verdict: auditPass.verdict })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec')))
    .orderBy(desc(auditPass.passNo))
    .limit(1);
  return latest?.verdict === 'clean';
}
