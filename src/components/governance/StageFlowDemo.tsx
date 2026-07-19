'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { StageStepper } from '@/components/forge/StageStepper';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { AutomationBar } from '@/components/forge/AutomationBar';
import { STAGE_SUBSTEPS } from '@/components/forge/stage-substeps';
import { STAGE_LABEL } from '@/projects/stage-lifecycle';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';

/**
 * Self-contained, interactive stage-flow demo for the governance page. It mirrors the real
 * app's TWO-STATE model:
 *   • `furthest` = progress (how far the project has advanced) — drives the green/done
 *     stages + phases and the (persistent) freeze locks. Preserved as you navigate.
 *   • `view`     = which stage/phase you're looking at (the real app reads this from the
 *     route). Clicking a REACHED stage/phase in the stepper moves the view back without
 *     losing progress; passed stages stay green. "Reset" clears both.
 * Locking and automation availability are DERIVED, never toggled: the freeze rule is the
 * one in src/projects/stage-gate.ts, and the hand-over unlocks at Spec › Finalize just as
 * SpecStageClient does. Automation then clears one gate per second to the end.
 * It reuses the real StageStepper + StageAdvance + AutomationBar and never calls the server.
 */
// Stage order + project phase are the only things the demo states itself; the display
// labels and the sub-phases come from the SAME constants the real stepper reads, so a
// change to either shows up here automatically instead of silently drifting.
const FLOW: { kind: StageKind; label: string; phase: ProjectPhase; phases: { key: string; label: string }[] }[] =
  ([
    ['exploration', 'design'],
    ['spec', 'design'],
    ['plan', 'design'],
    ['execute', 'build'],
    ['review', 'build'],
    ['journal', 'learn'],
  ] as [StageKind, ProjectPhase][]).map(([kind, phase]) => ({
    kind,
    label: STAGE_LABEL[kind],
    phase,
    phases: STAGE_SUBSTEPS[kind] ?? [],
  }));

const STEPS: { s: number; p: number }[] = FLOW.flatMap((stage, s) => stage.phases.map((_, p) => ({ s, p })));

/** The STEPS index for a given stage/phase — used to map clicks + stage bounds. */
const posFor = (s: number, p: number) => STEPS.findIndex((st) => st.s === s && st.p === p);

export function StageFlowDemo() {
  // `furthest` = number of completed steps (step `furthest` is the active one; === length ⇒ done).
  const [furthest, setFurthest] = useState(0);
  // `view` = the viewed step index (0..furthest); === length ⇒ viewing the completed end.
  const [view, setView] = useState(0);
  // Automation, run entirely locally: "Run automated" starts a real 3-2-1 hand-over, swaps
  // the demo surface to the cool `build` palette and drives a stage per second; "Stop &
  // take over" returns the wheel and the warm palette. Same components, same state machine
  // as a real project — it just never touches the server.
  const [on, setOn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  // Derived, not stored — so no effect ever has to setState synchronously to move
  // between the hand-over and the drive.
  const auto: 'off' | 'starting' | 'driving' = !on ? 'off' : countdown > 0 ? 'starting' : 'driving';

  // 3-2-1 hand-over.
  useEffect(() => {
    if (!on || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [on, countdown]);

  // While driving, advance a step a second until the flow completes.
  useEffect(() => {
    if (auto !== 'driving') return;
    const t = setTimeout(() => {
      const nv = Math.min(view + 1, STEPS.length);
      setView(nv);
      setFurthest((f) => Math.max(f, nv));
      if (nv >= STEPS.length) setOn(false);
    }, 1000);
    return () => clearTimeout(t);
  }, [auto, view]);

  const startAuto = () => { setCountdown(3); setOn(true); };
  const stopAuto = () => { setOn(false); setCountdown(0); };

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

  // Locking is a CONSEQUENCE of progress, exactly as src/projects/stage-gate.ts computes it
  // on a real project — there is no manual lock switch anywhere in the product:
  //   design stages (Explore · Spec · Plan) freeze once execution starts,
  //   Execute / Review / Journal each freeze once they are themselves done.
  const execFirst = posFor(3, 0);
  const execLast = posFor(3, FLOW[3].phases.length - 1);
  const reviewLast = posFor(4, FLOW[4].phases.length - 1);
  const executeStarted = furthest >= execFirst;
  const executeDone = furthest > execLast;
  const reviewDone = furthest > reviewLast;
  const journalDone = furthest >= STEPS.length;

  const lockFor = (kind: StageKind): string | undefined => {
    if (kind === 'exploration' || kind === 'spec' || kind === 'plan') {
      if (!executeStarted) return undefined;
      return executeDone ? 'Locked — execution has completed.' : 'Locked — execution is in progress.';
    }
    if (kind === 'execute') return executeDone ? 'Locked — execution is complete.' : undefined;
    if (kind === 'review') return reviewDone ? 'Locked — review is complete.' : undefined;
    return journalDone ? 'Locked — journal is complete.' : undefined;
  };
  const lockedStages: StageKind[] = FLOW.filter((st) => lockFor(st.kind)).map((st) => st.kind);
  const lockedReason = lockFor(viewedStage.kind);
  const locked = Boolean(lockedReason);

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

  const driving = auto !== 'off';

  // Which advances carry the padlock, mirroring the real clients exactly: Plan→Execute,
  // Execute→Review, Review→Reflect and the final Finish (SummaryPhase's "Mark complete")
  // pass `gate`; Explore→Spec and Spec→Plan do not.
  const GATED_FROM: StageKind[] = ['plan', 'execute', 'review', 'journal'];
  const gated = !isPhaseAdvance && GATED_FROM.includes(viewedStage.kind);

  // Automation availability mirrors what each real stage client passes as `disabled`:
  // Explore is hand-authored throughout, Spec unlocks only at Finalize, and from Plan
  // onward Forge can drive. A locked stage can never hand over.
  const inSpecPreFinalize = viewedStage.kind === 'spec' && viewedStage.phases[cur.p].key !== 'finalize';
  const autoDisabled = locked || viewDone || viewedStage.kind === 'exploration' || inSpecPreFinalize;
  const autoHint =
    viewedStage.kind === 'exploration'
      ? 'Automation unlocks once the spec is set — Design stages are hand-authored.'
      : inSpecPreFinalize
        ? 'Automation unlocks at the Document phase — Outline & Craft are hand-authored.'
        : 'Spec is ready — let Forge clear every gate through to the end.';

  return (
    // The palette swap is the real one: `data-phase="build"` is exactly what
    // PhaseFromRoute sets on a live project while Forge drives.
    <div data-phase={driving ? 'build' : 'design'} className="flex flex-col gap-4">
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

      {/* The stepper sits in the project layout's top sub-nav; the AutomationBar is the
          FIRST element of the stage body — i.e. directly BELOW the stepper (see
          PlanStageClient). `onRun` swaps the real network call for local state, so every
          state of the real component is reachable here without a project. */}
      <AutomationBar
        state={auto === 'off' ? 'idle' : auto}
        countdown={countdown}
        pulse
        disabled={autoDisabled}
        idleHint={autoHint}
        lockedReason={lockedReason}
        onRun={startAuto}
        onStop={stopAuto}
      />

      <div className="flex items-center gap-3">
        <div className="w-60">
          {isPhaseAdvance ? (
            <Button variant="primary" fullWidth rightIcon={<ArrowRight />} onClick={advance} disabled={driving || locked}>
              {continueLabel}
            </Button>
          ) : (
            <StageAdvance
              label={viewDone ? 'Completed' : continueLabel}
              onClick={advance}
              gate={gated}
              disabled={viewDone || driving || locked}
            />
          )}
        </div>
      </div>
    </div>
  );
}
