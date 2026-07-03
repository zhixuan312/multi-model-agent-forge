import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';

export async function canFreeze(db: Db, projectId: string): Promise<boolean> {
  const dbi = db ?? getDb();
  const [row] = await dbi.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return false;
  const d = validateDetails(row.details);
  const passes = d.stages.spec.phases.finalize.auditPasses;
  if (passes.length === 0) return false;
  return passes[passes.length - 1].status === 'clean';
}
