import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { stage } from '@/db/schema/projects';

export interface StagePerm {
  canMutate: boolean;
  canAdvance: boolean;
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

/**
 * Stage locking rules:
 *
 * Design phase (Explore, Spec, Plan) — freely editable until Execute starts.
 * Users can bounce between them, add research while writing the spec, etc.
 *
 * Build phase — each stage locks when completed, cascading backward:
 *   Execute done → locks Explore, Spec, Plan, Execute
 *   Review done  → locks Explore, Spec, Plan, Execute, Review
 *   Journal done → locks all
 */
export async function getStagePermissions(db: Db, projectId: string): Promise<StagePermissions> {
  const dbi = db ?? getDb();

  const stageRows = await dbi
    .select({ kind: stage.kind, status: stage.status })
    .from(stage)
    .where(eq(stage.projectId, projectId));

  const statusOf = (kind: string) => stageRows.find((r) => r.kind === kind)?.status ?? 'pending';

  const executeStatus = statusOf('execute');
  const executeStarted = executeStatus === 'active' || executeStatus === 'done';
  const executeDone = executeStatus === 'done';
  const reviewDone = statusOf('review') === 'done';
  const journalDone = statusOf('journal') === 'done';

  const designLocked = executeStarted;
  const designReason = executeDone ? 'Locked — execution has completed.' : 'Locked — execution is in progress.';

  return {
    explore: {
      canMutate: !designLocked,
      canAdvance: true,
      ...(designLocked && { reason: designReason }),
    },
    spec: {
      canMutate: !designLocked,
      canAdvance: true,
      ...(designLocked && { reason: designReason }),
    },
    plan: {
      canMutate: !designLocked,
      canAdvance: true,
      ...(designLocked && { reason: designReason }),
    },
    execute: {
      canMutate: !executeDone,
      canAdvance: true,
      ...(executeDone && { reason: 'Locked — execution is complete.' }),
    },
    review: {
      canMutate: !reviewDone,
      canAdvance: true,
      ...(reviewDone && { reason: 'Locked — review is complete.' }),
    },
    journal: {
      canMutate: !journalDone,
      canAdvance: true,
      ...(journalDone && { reason: 'Locked — journal is complete.' }),
    },
  };
}
