'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { StageStepper } from '@/components/forge/StageStepper';
import { StageAdvance } from '@/components/forge/StageAdvance';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';

/**
 * Self-contained, interactive stage-flow demo for the governance page. It mirrors the real
 * app's TWO-STATE model:
 *   • `furthest` = progress (how far the project has advanced) — drives the green/done
 *     stages + phases and the (persistent) freeze locks. Preserved as you navigate.
 *   • `view`     = which stage/phase you're looking at (the real app reads this from the
 *     route). Clicking a REACHED stage/phase in the stepper moves the view back without
 *     losing progress; passed stages stay green. "Reset" clears both.
 * It reuses the real StageStepper + StageAdvance and never mutates a real project.
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
const PHASE_ORDER: ProjectPhase[] = ['design', 'build', 'learn', 'completed'];

/** The STEPS index for a given stage/phase — used to map clicks + stage bounds. */
const posFor = (s: number, p: number) => STEPS.findIndex((st) => st.s === s && st.p === p);

export function StageFlowDemo() {
  // `furthest` = number of completed steps (step `furthest` is the active one; === length ⇒ done).
  const [furthest, setFurthest] = useState(0);
  // `view` = the viewed step index (0..furthest); === length ⇒ viewing the completed end.
  const [view, setView] = useState(0);

  const viewDone = view >= STEPS.length;
  const cur = viewDone ? { s: FLOW.length - 1, p: FLOW[FLOW.length - 1].phases.length - 1 } : STEPS[view];
  const viewedStage = FLOW[cur.s];

  // Stage statuses from PROGRESS — a passed stage stays 'done' (green) even while you view back.
  const stages = FLOW.map((stage, s): { kind: StageKind; status: StageStatus } => {
    const firstS = posFor(s, 0);
    const lastS = posFor(s, stage.phases.length - 1);
    let status: StageStatus;
    if (lastS < furthest) status = 'done';
    else if (firstS <= furthest && furthest <= lastS) status = 'active';
    else status = 'pending';
    return { kind: stage.kind, status };
  });

  // Locks follow PROGRESS (the freeze is persistent) — a stage locks once its whole project
  // phase is behind the frontier, and stays locked while you view earlier stages.
  const furthestPhaseIdx = furthest >= STEPS.length ? PHASE_ORDER.length - 1 : PHASE_ORDER.indexOf(FLOW[STEPS[furthest].s].phase);
  const lockedStages: StageKind[] = FLOW.filter((st) => PHASE_ORDER.indexOf(st.phase) < furthestPhaseIdx).map((st) => st.kind);

  // Sub-phase statuses (for the viewed stage) also from PROGRESS; the highlight follows VIEW.
  const subSteps = viewedStage.phases.map((ph) => ({ key: ph.key, label: ph.label }));
  const subStepStatuses: Record<string, string> = {};
  viewedStage.phases.forEach((ph, p) => {
    const gIdx = posFor(cur.s, p);
    subStepStatuses[ph.key] = gIdx < furthest ? 'done' : gIdx === furthest ? 'active' : 'pending';
  });

  // Continue advances the VIEW forward one step; at the frontier it extends progress.
  const isPhaseAdvance = !viewDone && cur.p + 1 < viewedStage.phases.length;
  let continueLabel = 'Finish';
  if (!viewDone) {
    if (isPhaseAdvance) continueLabel = `Continue to ${viewedStage.phases[cur.p + 1].label}`;
    else if (cur.s + 1 < FLOW.length) continueLabel = `Continue to ${FLOW[cur.s + 1].label}`;
    else continueLabel = 'Finish';
  }
  const advance = () =>
    setView((v) => {
      const nv = Math.min(v + 1, STEPS.length);
      setFurthest((f) => Math.max(f, nv));
      return nv;
    });

  return (
    <div className="flex flex-col gap-4">
      {/* The REAL StageStepper. Reached stages render as links; we intercept those clicks
          (via its data-stage / data-reachable attributes) to move the VIEW back locally.
          Future/untouched stages are non-reachable → not clickable. */}
      <div className="overflow-x-auto rounded-md border border-line bg-surface-1 py-4">
        <div
          className="min-w-[760px] px-16"
          onClickCapture={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>('[data-stage]');
            if (el?.getAttribute('data-reachable') === 'true') {
              e.preventDefault();
              const s = FLOW.findIndex((st) => st.kind === el.getAttribute('data-stage'));
              if (s >= 0) setView(posFor(s, 0));
            }
          }}
        >
          <StageStepper
            projectId="preview"
            stages={stages}
            currentStage={viewedStage.kind}
            phase={viewDone ? 'completed' : viewedStage.phase}
            lockedStages={lockedStages}
            subSteps={subSteps}
            subStepStatuses={subStepStatuses}
            activeSubPhase={viewDone ? undefined : viewedStage.phases[cur.p].key}
            onSubStepClick={(key) => {
              const p = viewedStage.phases.findIndex((ph) => ph.key === key);
              if (p >= 0) setView(posFor(cur.s, p));
            }}
          />
        </div>
      </div>

      <div className="w-60">
        {isPhaseAdvance ? (
          <Button variant="primary" fullWidth rightIcon={<ArrowRight />} onClick={advance}>
            {continueLabel}
          </Button>
        ) : (
          <StageAdvance label={viewDone ? 'Completed' : continueLabel} onClick={advance} disabled={viewDone} />
        )}
      </div>
    </div>
  );
}
