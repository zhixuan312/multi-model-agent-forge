import { eq } from 'drizzle-orm';
import { STAGE_ORDER, type StageKind, type StageStatus } from '@/db/enums';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { getCurrentPhase } from '@/details/read';
import { updateDetails } from '@/details/write';

export interface StageRow {
  kind: StageKind;
  status: StageStatus;
  lastPhase?: string | null;
}

export type VisualState = 'not_started' | 'ongoing' | 'done' | 'locked';

export interface ComputedStageView {
  kind: StageKind;
  label: string;
  visual: VisualState;
  reachable: boolean;
  isCurrent: boolean;
}

const STAGE_LABEL: Record<StageKind, string> = {
  exploration: 'Explore',
  spec: 'Spec',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
  journal: 'Reflect',
};

export async function ensureStageReached(db: Db, projectId: string, viewingStage: StageKind): Promise<void> {
  const viewIdx = STAGE_ORDER.indexOf(viewingStage);
  if (viewIdx < 0) return;

  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return;
  const d = validateDetails(row.details);

  const DESIGN_BOUNDARY = 3;
  const now = new Date().toISOString();

  let changed = false;

  if (viewIdx >= DESIGN_BOUNDARY) {
    for (let i = 0; i < viewIdx; i++) {
      const kind = STAGE_ORDER[i];
      const stg = d.stages[kind];
      if (stg.status !== 'done') {
        stg.status = 'done';
        if (!stg.completedAt) stg.completedAt = now;
        if (!stg.startedAt) stg.startedAt = now;
        changed = true;
      }
    }
  }

  const viewStg = d.stages[viewingStage];
  if (viewStg.status === 'pending') {
    viewStg.status = 'active';
    if (!viewStg.startedAt) viewStg.startedAt = now;
    changed = true;
  }

  if (changed) {
    await updateDetails(db, projectId, () => d);
  }
}

export function computeAllStages(
  stages: StageRow[],
  viewingStage: StageKind | null,
  lockedStages: StageKind[] = [],
): ComputedStageView[] {
  const statusByKind = new Map(stages.map((s) => [s.kind, s.status]));
  const lockedSet = new Set(lockedStages);

  const furthestIdx = STAGE_ORDER.reduce((max, kind, i) => {
    const s = statusByKind.get(kind);
    return (s === 'active' || s === 'done') ? Math.max(max, i) : max;
  }, viewingStage ? STAGE_ORDER.indexOf(viewingStage) : -1);

  const viewIdx = viewingStage ? STAGE_ORDER.indexOf(viewingStage) : -1;

  return STAGE_ORDER.map((kind, i) => {
    const status = statusByKind.get(kind) ?? 'pending';
    const isCurrent = viewingStage === kind;
    const beforeViewing = viewIdx >= 0 && i < viewIdx;
    const implicitlyDone = beforeViewing && i <= furthestIdx;

    let visual: VisualState;
    if ((status === 'done' || implicitlyDone) && lockedSet.has(kind)) visual = 'locked';
    else if (status === 'done' || implicitlyDone) visual = 'done';
    else if (status === 'active' || isCurrent) visual = 'ongoing';
    else visual = 'not_started';

    return {
      kind,
      label: STAGE_LABEL[kind],
      visual,
      reachable: i <= furthestIdx || isCurrent,
      isCurrent,
    };
  });
}
