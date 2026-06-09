import { cn } from '@/lib/cn';

/**
 * StageStepper — pure, props-driven (Spec 1 shell-component props contract,
 * F34). Renders the design / freeze / build groups from `steps[]`; not yet
 * project-driven (Spec 3 will compute `state` from `stage.status`). The
 * `state` enum is exactly what that wiring produces.
 */

export type StageState = 'locked' | 'active' | 'done';

export interface StageStepperStep {
  group: 'design' | 'freeze' | 'build';
  stage: 'exploration' | 'spec' | 'freeze' | 'plan' | 'execute' | 'review';
  label: string;
  state: StageState;
}

export interface StageStepperProps {
  steps: StageStepperStep[];
  /** Tablet: icons + active label only. */
  condensed?: boolean;
}

const GROUP_ORDER: StageStepperStep['group'][] = ['design', 'freeze', 'build'];
const GROUP_LABEL: Record<StageStepperStep['group'], string> = {
  design: 'Design',
  freeze: 'Freeze',
  build: 'Build',
};

function stepClasses(state: StageState): string {
  return cn(
    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
    state === 'active' && 'bg-surface text-accent-deep font-semibold shadow-sm',
    state === 'done' && 'text-accent-deep font-medium',
    state === 'locked' && 'text-ink-faint',
  );
}

export function StageStepper({ steps, condensed = false }: StageStepperProps) {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    steps: steps.filter((s) => s.group === group),
  })).filter((g) => g.steps.length > 0);

  return (
    <nav
      aria-label="Stage progress"
      data-condensed={condensed ? 'true' : undefined}
      className="flex items-center gap-2"
    >
      {groups.map(({ group, steps: groupSteps }, gi) => (
        <div key={group} className="flex items-center gap-2">
          {gi > 0 ? (
            <span aria-hidden="true" className="text-line-strong">
              ›
            </span>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
              {GROUP_LABEL[group]}
            </span>
            <div className="flex gap-1 rounded-full bg-accent-tint/60 p-1">
              {groupSteps.map((step) => {
                // Condensed: show the label only for the active step.
                const showLabel = !condensed || step.state === 'active';
                return (
                  <span
                    key={step.stage}
                    data-stage={step.stage}
                    data-state={step.state}
                    aria-current={step.state === 'active' ? 'step' : undefined}
                    className={stepClasses(step.state)}
                  >
                    <span aria-hidden="true">
                      {step.state === 'done' ? '●' : step.state === 'active' ? '◐' : '○'}
                    </span>
                    {showLabel ? <span>{step.label}</span> : null}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </nav>
  );
}
