'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { StageStepper } from '@/components/forge/StageStepper';
import { STAGE_SUBSTEPS, stagePhaseStore, useStageSubPhase, useStageNavigable } from '@/components/forge/stage-substeps';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';

/**
 * Mock-only stepper that highlights the stage you're actually viewing. The real
 * stepper reflects the project's stored resume pointer; in the mock walk-through
 * we want the URL to drive the highlight so navigating into /spec lights up Spec.
 * Reads the active route segment and marks design stages reachable up to it.
 */
const SEGMENT_TO_STAGE: Record<string, StageKind> = {
  explore: 'exploration',
  spec: 'spec',
  plan: 'plan',
  execute: 'execute',
  review: 'review',
  journal: 'journal',
};

const STAGE_ORDER: StageKind[] = ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'];

export function MockStageStepper({ projectId, phase }: { projectId: string; phase: ProjectPhase }) {
  const seg = useSelectedLayoutSegment();
  const current: StageKind = (seg ? SEGMENT_TO_STAGE[seg] : undefined) ?? 'exploration';
  const ci = STAGE_ORDER.indexOf(current);
  const stages = STAGE_ORDER.map((kind, i) => ({
    kind,
    status: (i < ci ? 'done' : i === ci ? 'active' : 'pending') as StageStatus,
  }));
  const subPhase = useStageSubPhase();
  const navigable = useStageNavigable();
  return (
    <StageStepper
      projectId={projectId}
      stages={stages}
      currentStage={current}
      phase={phase}
      subSteps={STAGE_SUBSTEPS[current]}
      activeSubPhase={subPhase}
      onSubStepClick={navigable ? stagePhaseStore.navigate : undefined}
    />
  );
}
