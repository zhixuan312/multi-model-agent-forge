'use client';

import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Eyebrow } from '@/components/ui';
import { showToast } from '@/components/ui/toast';
import { StageStepper } from '@/components/forge/StageStepper';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { AutomationBar } from '@/components/forge/AutomationBar';
import { StageFlowDemo } from '@/components/governance/StageFlowDemo';
import { STAGE_FLOW_VARIANTS } from '@/components/governance/variant-meta';

// Demo stage sets for the stepper's visual states.
const STAGES_ACTIVE = [
  { kind: 'exploration' as const, status: 'done' as const },
  { kind: 'spec' as const, status: 'done' as const },
  { kind: 'plan' as const, status: 'active' as const },
  { kind: 'execute' as const, status: 'pending' as const },
  { kind: 'review' as const, status: 'pending' as const },
  { kind: 'journal' as const, status: 'pending' as const },
];
const STAGES_SKIPPED = [
  { kind: 'exploration' as const, status: 'done' as const },
  { kind: 'spec' as const, status: 'done' as const },
  { kind: 'plan' as const, status: 'active' as const },
  { kind: 'execute' as const, status: 'skipped' as const },
  { kind: 'review' as const, status: 'skipped' as const },
  { kind: 'journal' as const, status: 'pending' as const },
];

function StepperFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-md border border-line bg-surface-1 p-4">{children}</div>;
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="text-ink-faint">{label}</Eyebrow>
      {children}
    </div>
  );
}

/** Per-surface renders for the Stage-flow control, keyed by STAGE_FLOW_VARIANTS. All real
 *  components (StageStepper / StageAdvance / Button / AutomationBar) — demo content only. */
const RENDERS: Record<string, () => ReactNode> = {
  // The whole flow, interactive — advance phase→stage→next, or reset.
  flow: () => (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-ink-faint">
        The real flow, end to end. <strong>Continue</strong> clears the next gate — to the next{' '}
        <strong>phase</strong> within the stage, or to the next <strong>stage</strong> once its phases complete;
        click any reached stage or phase in the stepper to look back. Automation stays disabled while the design
        stages are hand-authored and unlocks at <strong>Spec › Finalize</strong>, exactly as it does on a project.
        From there <strong>Run automated</strong> hands over: a 3-2-1 countdown, the surface swaps to the cool{' '}
        <strong>build</strong> palette, and Forge clears one gate a second until{' '}
        <strong>Stop &amp; take over</strong> returns the wheel and the warm <strong>design</strong> palette.
        Stages freeze as you pass them — the design stages once execution starts, then each of Execute, Review and
        Journal as it completes — and a frozen stage says why and disables every action, so at the end only{' '}
        <strong>Reset</strong> is left. (Demo only — local state, never calls the server.)
      </p>
      <StageFlowDemo />
    </div>
  ),

  // The stepper's visual states: active · locked · skipped.
  stepper: () => (
    <div className="flex flex-col gap-6">
      <Labeled label="Active run — done (sage) · ongoing (accent) · pending (line)">
        <StepperFrame>
          <StageStepper projectId="preview" stages={STAGES_ACTIVE} currentStage="plan" phase="design" />
        </StepperFrame>
      </Labeled>
      <Labeled label="Locked — prior stages read-only after advancing (sage + lock)">
        <StepperFrame>
          <StageStepper projectId="preview" stages={STAGES_ACTIVE} currentStage="plan" phase="design" lockedStages={['exploration', 'spec']} />
        </StepperFrame>
      </Labeled>
      <Labeled label="Subset run — skipped stages (BYO artifact)">
        <StepperFrame>
          <StageStepper projectId="preview" stages={STAGES_SKIPPED} currentStage="plan" phase="design" />
        </StepperFrame>
      </Labeled>
    </div>
  ),

  // The advance button has exactly two forms and one modifier, and every one of them is
  // declared here — a form that isn't in this list must not exist in a stage client.
  //   form:     phase advance (terracotta Button) · stage advance (black StageAdvance)
  //   modifier: `gate` — the padlock, on a stage advance that commits something
  //             irreversible. Production uses it on exactly four: Plan→Execute,
  //             Execute→Review, Review→Reflect, and "Mark complete" (project done).
  advance: () => (
    <div className="flex max-w-sm flex-col gap-6">
      <Labeled label="Phase advance — a step within a stage (terracotta)">
        <Button variant="primary" fullWidth rightIcon={<ArrowRight />}>Continue to Synthesize</Button>
      </Labeled>
      <Labeled label="Phase advance, disabled — phase gate not met (dimmed terracotta)">
        <Button variant="primary" fullWidth disabled rightIcon={<ArrowRight />}>Continue to Finalize</Button>
      </Labeled>
      <Labeled label="Stage advance — cross into the next stage (black)">
        <StageAdvance onClick={() => {}} label="Continue to Spec" />
      </Labeled>
      <Labeled label="Stage advance, disabled — the stage's gate is not cleared yet">
        <StageAdvance onClick={() => {}} label="Continue to Plan" disabled />
      </Labeled>
      <Labeled label="Gated stage advance — commits something irreversible (black + lock)">
        <StageAdvance onClick={() => {}} label="Continue to Execute" gate />
      </Labeled>
      <Labeled label="Gated stage advance, disabled — the gate has not cleared yet">
        <StageAdvance onClick={() => {}} label="Continue to Review" gate disabled />
      </Labeled>
      <Labeled label="Gated stage advance, spent — the project is complete; the control stays, disabled">
        <StageAdvance onClick={() => {}} label="Completed" gate disabled />
      </Labeled>
      <Labeled label="Advance failed — an error toast (click to trigger, bottom-right)">
        <StageAdvance onClick={() => showToast({ type: 'error', message: 'Cannot advance yet.' })} label="Continue to Reflect" gate />
      </Labeled>
    </div>
  ),

  // Every state the bar can be in, all five declared here. The first two are rendered by
  // the stage clients; the last three by AutomationOverlay, which used to hand-roll its own
  // copy of this strip — it now passes `state` instead, so there is one implementation.
  automation: () => (
    <div className="flex flex-col gap-6">
      <Labeled label="Idle — you drive, or hand over to Forge (rendered by every stage)">
        <AutomationBar projectId="preview" disabled={false} idleHint="AI clears every gate — you review the PR at the end." />
      </Labeled>
      <Labeled label="Idle, disabled — the stage can't hand over yet (Explore · Spec before Finalize)">
        <AutomationBar projectId="preview" disabled idleHint="Automation unlocks at the Document phase — Outline & Craft are hand-authored." />
      </Labeled>
      <Labeled label="Locked — the stage is read-only, and says why">
        <AutomationBar projectId="preview" disabled lockedReason="Locked — execution is in progress." />
      </Labeled>
      <Labeled label="Starting — the 3-2-1 hand-over, before Forge takes the wheel">
        <AutomationBar state="starting" countdown={3} disabled={false} onStop={() => {}} />
      </Labeled>
      <Labeled label="Driving — Forge is clearing gates (the stage itself is replaced by the overlay)">
        <AutomationBar state="driving" pulse disabled={false} onStop={() => {}} />
      </Labeled>
      <Labeled label="Viewing — the read-only activity log on a finished project">
        <AutomationBar state="viewing" disabled={false} onClose={() => {}} />
      </Labeled>
    </div>
  ),
};

/** Renders one Stage-flow control surface (a sub-page), by id. */
export function StageFlowVariant({ id }: { id: string }) {
  const render = RENDERS[id];
  return <>{render ? render() : null}</>;
}

/** Overview (the slot's default page) — every stage-control surface stacked, in meta order. */
export function StageFlowPreview() {
  return (
    <div className="flex flex-col gap-8">
      {STAGE_FLOW_VARIANTS.map((v) => (
        <div key={v.id} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{v.label}</p>
          {RENDERS[v.id]?.()}
        </div>
      ))}
    </div>
  );
}
