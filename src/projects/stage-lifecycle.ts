import { STAGE_ORDER, type StageKind, type StageStatus } from '@/db/enums';

export interface StageRow {
  kind: StageKind;
  status: StageStatus;
  lastPhase?: string | null;
}

export type VisualState = 'not_started' | 'ongoing' | 'done' | 'locked' | 'skipped';

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

// NOTE: a stage-page render is strictly READ-ONLY — it must never mutate stage
// state. Viewing/refreshing a stage URL (even a stale one, e.g. `/review` while the
// auto-driver is mid-`plan`) previously called an `ensureStageReached` writer that
// force-marked prior stages `done` + the viewed stage `active`, clobbering the
// driver's in-progress work and jumping the pipeline out of order. Stage
// progression now comes ONLY from the auto-driver or the `/advance` route. The
// stepper's "this path is done" appearance is computed read-only by
// `computeAllStages` (the `viewingStage` argument), with the DB left untouched.

const isPassed = (status: StageStatus | undefined) => status === 'done' || status === 'skipped';

export function computeAllStages(
  stages: StageRow[],
  viewingStage: StageKind | null,
  lockedStages: StageKind[] = [],
): ComputedStageView[] {
  const statusByKind = new Map(stages.map((s) => [s.kind, s.status]));
  const lockedSet = new Set(lockedStages);

  const furthestIdx = STAGE_ORDER.reduce((max, kind, i) => {
    const s = statusByKind.get(kind);
    return (s === 'active' || isPassed(s)) ? Math.max(max, i) : max;
  }, viewingStage ? STAGE_ORDER.indexOf(viewingStage) : -1);

  const viewIdx = viewingStage ? STAGE_ORDER.indexOf(viewingStage) : -1;

  return STAGE_ORDER.map((kind, i) => {
    const status = statusByKind.get(kind) ?? 'pending';
    const isCurrent = viewingStage === kind;
    const beforeViewing = viewIdx >= 0 && i < viewIdx;
    const implicitlyDone = beforeViewing && i <= furthestIdx;

    let visual: VisualState;
    if (status === 'skipped') visual = 'skipped';
    else if ((status === 'done' || implicitlyDone) && lockedSet.has(kind)) visual = 'locked';
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
