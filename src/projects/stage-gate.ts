import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import {
  allStagesLocked,
  allStagesOpen,
  stagePermissionsFrom,
  type StagePermissions,
} from '@/projects/stage-freeze';

/**
 * Reads a project's progress and applies the freeze rule. The RULE itself lives in
 * `stage-freeze.ts`, DB-free, so the governance demo can apply the same one instead of
 * restating it.
 */
export async function getStagePermissions(db: Db, projectId: string): Promise<StagePermissions> {
  const [proj] = await db
    .select({ completedAt: project.completedAt, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  if (proj?.completedAt) return allStagesLocked('Project is complete.');
  if (!proj?.details) return allStagesOpen();

  const d = validateDetails(proj.details);
  const executeStatus = d.stages.execute.status;
  return stagePermissionsFrom({
    executeStarted: executeStatus === 'active' || executeStatus === 'done',
    executeDone: executeStatus === 'done',
    reviewDone: d.stages.review.status === 'done',
    journalDone: d.stages.journal.status === 'done',
  });
}
