import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';

export interface StagePerm {
  canMutate: boolean;
  /** Why the stage is read-only. Surfaced by AutomationBar; set iff !canMutate. */
  reason?: string;
}

export interface StagePermissions {
  explore: StagePerm;
  spec: StagePerm;
  plan: StagePerm;
  execute: StagePerm;
  review: StagePerm;
  journal: StagePerm;
}

export async function getStagePermissions(db: Db, projectId: string): Promise<StagePermissions> {
  const dbi = db ?? getDb();

  const [proj] = await dbi
    .select({ completedAt: project.completedAt, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  if (proj?.completedAt) {
    const locked = { canMutate: false, reason: 'Project is complete.' };
    return { explore: locked, spec: locked, plan: locked, execute: locked, review: locked, journal: locked };
  }

  if (!proj?.details) {
    const open = { canMutate: true };
    return { explore: open, spec: open, plan: open, execute: open, review: open, journal: open };
  }

  const d = validateDetails(proj.details);
  const executeStatus = d.stages.execute.status;
  const executeStarted = executeStatus === 'active' || executeStatus === 'done';
  const executeDone = executeStatus === 'done';
  const reviewDone = d.stages.review.status === 'done';
  const journalDone = d.stages.journal.status === 'done';

  const designLocked = executeStarted;
  const designReason = executeDone ? 'Locked — execution has completed.' : 'Locked — execution is in progress.';

  return {
    explore: { canMutate: !designLocked, ...(designLocked && { reason: designReason }) },
    spec: { canMutate: !designLocked, ...(designLocked && { reason: designReason }) },
    plan: { canMutate: !designLocked, ...(designLocked && { reason: designReason }) },
    execute: { canMutate: !executeDone, ...(executeDone && { reason: 'Locked — execution is complete.' }) },
    review: { canMutate: !reviewDone, ...(reviewDone && { reason: 'Locked — review is complete.' }) },
    journal: { canMutate: !journalDone, ...(journalDone && { reason: 'Locked — journal is complete.' }) },
  };
}
