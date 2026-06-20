import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';

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

export async function getStagePermissions(db: Db, projectId: string): Promise<StagePermissions> {
  const dbi = db ?? getDb();

  const [counts] = await dbi
    .select({
      draftedComponents: sql<number>`(
        SELECT count(*) FROM forge.project_component c
        JOIN forge.project_stage s ON s.id = c.stage_id
        WHERE s.project_id = ${projectId} AND c.status != 'gathering'
      )`,
      planTasks: sql<number>`(
        SELECT count(*) FROM forge.project_plan_task WHERE project_id = ${projectId}
      )`,
      executingTasks: sql<number>`(
        SELECT count(*) FROM forge.project_plan_task
        WHERE project_id = ${projectId} AND status != 'queued'
      )`,
      totalTasks: sql<number>`(
        SELECT count(*) FROM forge.project_plan_task WHERE project_id = ${projectId}
      )`,
    })
    .from(project)
    .where(eq(project.id, projectId));

  if (!counts) throw new Error(`Project ${projectId} not found`);

  const dc = Number(counts.draftedComponents);
  const pt = Number(counts.planTasks);
  const et = Number(counts.executingTasks);

  return {
    explore: {
      canMutate: dc === 0,
      canAdvance: true,
      ...(dc > 0 && { reason: 'Exploration is locked — the spec has started drafting from your findings.' }),
    },
    spec: {
      canMutate: pt === 0,
      canAdvance: true,
      ...(pt > 0 && { reason: 'Spec is locked — the implementation plan has been authored.' }),
    },
    plan: {
      canMutate: et === 0,
      canAdvance: true,
      ...(et > 0 && { reason: 'Plan is locked — execution has started.' }),
    },
    execute: { canMutate: true, canAdvance: true },
    review: { canMutate: true, canAdvance: true },
    journal: { canMutate: true, canAdvance: true },
  };
}
