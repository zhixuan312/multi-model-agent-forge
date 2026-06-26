import { and, eq } from 'drizzle-orm';
import { STAGE_ORDER, type StageKind, type StageStatus } from '@/db/enums';
import type { Db } from '@/db/client';
import { stage, project } from '@/db/schema/projects';

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
  journal: 'Journal',
};

/**
 * Ensure the DB reflects that a stage has been reached. Called from the
 * project layout on every navigation — the SINGLE place stage state is
 * persisted.
 *
 * - All stages before `viewingStage` are marked 'done' (if still active/pending)
 * - `viewingStage` itself is marked 'active' (if still pending)
 * - Stages already 'done' are never touched (going back doesn't undo them)
 * - The project's `currentStage` is set to the max of its current value
 *   and `viewingStage` (never moves backward)
 */
export async function ensureStageReached(db: Db, projectId: string, viewingStage: StageKind): Promise<void> {
  const viewIdx = STAGE_ORDER.indexOf(viewingStage);
  if (viewIdx < 0) return;

  const now = new Date();

  const rows = await db
    .select({ kind: stage.kind, status: stage.status })
    .from(stage)
    .where(eq(stage.projectId, projectId));
  const statusByKind = new Map(rows.map((r) => [r.kind, r.status]));

  for (let i = 0; i < viewIdx; i++) {
    const kind = STAGE_ORDER[i];
    const s = statusByKind.get(kind);
    if (s !== 'done') {
      await db
        .update(stage)
        .set({ status: 'done', completedAt: now, ...(s === 'pending' ? { startedAt: now } : {}) })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, kind)));
    }
  }

  const viewStatus = statusByKind.get(viewingStage);
  if (viewStatus === 'pending') {
    await db
      .update(stage)
      .set({ status: 'active', startedAt: now })
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, viewingStage)));
  }

  const [proj] = await db
    .select({ currentStage: project.currentStage })
    .from(project)
    .where(eq(project.id, projectId));
  if (proj) {
    const currentIdx = proj.currentStage ? STAGE_ORDER.indexOf(proj.currentStage as StageKind) : -1;
    if (viewIdx > currentIdx) {
      await db
        .update(project)
        .set({ currentStage: viewingStage, updatedAt: now })
        .where(eq(project.id, projectId));
    }
  }
}

/**
 * Compute visual state + reachability for all 6 stages.
 *
 * Rules:
 * - Visual state is derived from DB status + lock permissions. The viewing
 *   stage only controls which pill is highlighted (`isCurrent`), never the
 *   indicator shape.
 * - Reachability: any stage that has ever been active/done stays navigable.
 *   The viewing stage is always reachable.
 */
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
