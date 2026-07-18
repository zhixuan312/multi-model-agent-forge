'use client';

import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Eyebrow } from '@/components/ui';
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
        Interactive — click <strong>Continue</strong> to run the next transition: advance to the next{' '}
        <strong>phase</strong> within the current stage, or to the next <strong>stage</strong> once its phases
        complete. <strong>Reset</strong> returns to the start. (Demo only — it never mutates a real project.)
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

  // The advance-button states: phase (terracotta) · stage (black) · gated (gray + lock).
  advance: () => (
    <div className="flex max-w-sm flex-col gap-6">
      <Labeled label="Phase advance — a step within a stage (terracotta)">
        <Button variant="primary" fullWidth rightIcon={<ArrowRight />}>Continue to Synthesize</Button>
      </Labeled>
      <Labeled label="Stage advance — cross into the next stage (black)">
        <StageAdvance onClick={() => {}} label="Continue to Spec" />
      </Labeled>
      <Labeled label="Stage advance, gated — gate not cleared (gray + lock)">
        <StageAdvance onClick={() => {}} label="Continue to Execute" gate disabled />
      </Labeled>
      <Labeled label="Advance failed — rose error line under the button">
        <div className="flex flex-col gap-1.5">
          <StageAdvance onClick={() => {}} label="Continue to Plan" />
          <p className="text-center text-xs text-[var(--rose-deep)]">Cannot advance yet.</p>
        </div>
      </Labeled>
    </div>
  ),

  // The automation bar: off (human clears gates) · running (AI clears + advances).
  automation: () => (
    <div className="flex flex-col gap-6">
      <Labeled label="Off — a human clears each gate">
        <AutomationBar projectId="preview" mode="off" note="" disabled={false} idleHint="AI clears every gate — you review the PR at the end." />
      </Labeled>
      <Labeled label="Running — AI auto-clears gates and advances">
        <AutomationBar projectId="preview" mode="running" note="Automation running — advancing through gates." disabled={false} />
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
