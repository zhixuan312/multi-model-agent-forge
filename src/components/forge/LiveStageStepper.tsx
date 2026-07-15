'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { StageStepper } from '@/components/forge/StageStepper';
import { STAGE_SUBSTEPS, stagePhaseStore, useStageSubPhase } from '@/components/forge/stage-substeps';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';

const SEGMENT_TO_STAGE: Record<string, StageKind> = {
  explore: 'exploration',
  spec: 'spec',
  plan: 'plan',
  execute: 'execute',
  build: 'execute',
  review: 'review',
  journal: 'journal',
};

export function LiveStageStepper({
  projectId,
  stages,
  currentStage,
  phase,
  lockedStages,
  autoMode,
  activePhase,
  phaseStatusByStage,
}: {
  projectId: string;
  stages: { kind: StageKind; status: StageStatus; lastPhase?: string | null }[];
  currentStage: StageKind | null;
  phase: ProjectPhase;
  lockedStages?: StageKind[];
  autoMode?: boolean;
  activePhase?: string;
  /** Per-stage → per-phase status, from the project details, so the sub-phase track can
   *  render skipped phases and block navigating to them (subset runs). */
  phaseStatusByStage?: Partial<Record<StageKind, Record<string, string>>>;
}) {
  const seg = useSelectedLayoutSegment();
  const subPhaseLive = useStageSubPhase();
  const routeStage: StageKind = (seg ? SEGMENT_TO_STAGE[seg] : undefined) ?? currentStage ?? 'exploration';
  // While Forge is driving, the stepper must follow the ACTIVE stage: automation
  // advances stages without navigating the URL, so the route segment lags behind
  // (e.g. still on /spec while automation is on Plan). Otherwise follow the route.
  const viewingStage: StageKind = autoMode ? (currentStage ?? routeStage) : routeStage;
  const subPhase = autoMode && activePhase ? activePhase : subPhaseLive;

  return (
    <StageStepper
      projectId={projectId}
      stages={stages}
      currentStage={viewingStage}
      phase={phase}
      lockedStages={lockedStages}
      subSteps={STAGE_SUBSTEPS[viewingStage]}
      subStepStatuses={phaseStatusByStage?.[viewingStage]}
      activeSubPhase={subPhase}
      onSubStepClick={stagePhaseStore.navigate}
    />
  );
}
