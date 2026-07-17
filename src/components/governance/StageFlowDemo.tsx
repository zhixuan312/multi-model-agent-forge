'use client';

import { useState } from 'react';
import { StageStepper } from '@/components/forge/StageStepper';
import { StageAdvance } from '@/components/forge/StageAdvance';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';

/**
 * Self-contained, interactive stage-flow demo for the governance page. Clicking
 * "Continue" runs the next transition LOCALLY (advance to the next phase, or the
 * next stage once a stage's phases are done); "Reset" returns to the start. It does
 * NOT hit /api/projects/[id]/transition — this is a showcase, so it never mutates a
 * real project — but it exercises the same StageStepper + StageAdvance components
 * and the same phase→stage advance semantics.
 */
const FLOW: { kind: StageKind; label: string; phase: ProjectPhase; phases: { key: string; label: string }[] }[] = [
  { kind: 'exploration', label: 'Explore', phase: 'design', phases: [{ key: 'brief', label: 'Brief' }, { key: 'discover', label: 'Discover' }, { key: 'synthesize', label: 'Synthesize' }] },
  { kind: 'spec', label: 'Spec', phase: 'design', phases: [{ key: 'outline', label: 'Outline' }, { key: 'craft', label: 'Craft' }, { key: 'finalize', label: 'Finalize' }] },
  { kind: 'plan', label: 'Plan', phase: 'design', phases: [{ key: 'refine', label: 'Refine' }, { key: 'validate', label: 'Validate' }] },
  { kind: 'execute', label: 'Execute', phase: 'build', phases: [{ key: 'configure', label: 'Configure' }, { key: 'implement', label: 'Implement' }] },
  { kind: 'review', label: 'Review', phase: 'build', phases: [{ key: 'review', label: 'Review' }] },
  { kind: 'journal', label: 'Journal', phase: 'learn', phases: [{ key: 'journal', label: 'Journal' }, { key: 'summary', label: 'Summary' }] },
];

const STEPS: { s: number; p: number }[] = FLOW.flatMap((stage, s) => stage.phases.map((_, p) => ({ s, p })));

export function StageFlowDemo() {
  const [pos, setPos] = useState(0); // index into STEPS; === STEPS.length ⇒ fully completed
  const done = pos >= STEPS.length;
  const cur = done ? { s: FLOW.length - 1, p: FLOW[FLOW.length - 1].phases.length - 1 } : STEPS[pos];

  const stages = FLOW.map((stage, s): { kind: StageKind; status: StageStatus } => {
    let status: StageStatus;
    if (done || s < cur.s) status = 'done';
    else if (s === cur.s) status = 'active';
    else status = 'pending';
    return { kind: stage.kind, status };
  });

  const currentFlow = FLOW[cur.s];
  const subSteps = currentFlow.phases.map((ph) => ({ key: ph.key, label: ph.label }));
  const subStepStatuses: Record<string, string> = {};
  currentFlow.phases.forEach((ph, p) => {
    subStepStatuses[ph.key] = done || p < cur.p ? 'done' : p === cur.p ? 'active' : 'pending';
  });

  let continueLabel = 'Finish';
  if (!done) {
    if (cur.p + 1 < currentFlow.phases.length) continueLabel = `Continue to ${currentFlow.phases[cur.p + 1].label}`;
    else if (cur.s + 1 < FLOW.length) continueLabel = `Continue to ${FLOW[cur.s + 1].label}`;
    else continueLabel = 'Finish';
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The REAL StageStepper, identical to the app — phases render under the active
          stage. That built-in sub-phase row is centered under the active column and can
          extend past a narrow box, so we give it a wide, horizontally-scrollable track
          with generous side padding to absorb the overhang (the app gets this room from
          its full-width shell). */}
      <div className="overflow-x-auto rounded-md border border-line bg-surface-1 py-4">
        <div className="min-w-[760px] px-16">
          <StageStepper
            projectId="preview"
            stages={stages}
            currentStage={currentFlow.kind}
            phase={done ? 'completed' : currentFlow.phase}
            subSteps={subSteps}
            subStepStatuses={subStepStatuses}
            activeSubPhase={done ? undefined : currentFlow.phases[cur.p].key}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-60">
          <StageAdvance
            label={done ? 'Completed' : continueLabel}
            onClick={() => setPos((p) => Math.min(p + 1, STEPS.length))}
            disabled={done}
          />
        </div>
        <button
          type="button"
          onClick={() => setPos(0)}
          className="rounded-[var(--r)] border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
