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
}: {
  projectId: string;
  stages: { kind: StageKind; status: StageStatus }[];
  currentStage: StageKind | null;
  phase: ProjectPhase;
  lockedStages?: StageKind[];
}) {
  const seg = useSelectedLayoutSegment();
  const viewingStage: StageKind = (seg ? SEGMENT_TO_STAGE[seg] : undefined) ?? currentStage ?? 'exploration';
  const subPhase = useStageSubPhase();

  return (
    <StageStepper
      projectId={projectId}
      stages={stages}
      currentStage={viewingStage}
      phase={phase}
      lockedStages={lockedStages}
      subSteps={STAGE_SUBSTEPS[viewingStage]}
      activeSubPhase={subPhase}
      onSubStepClick={stagePhaseStore.navigate}
    />
  );
}
