import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';
import { stageRoute } from '@/projects/stage-route';

/**
 * StageStepper (Spec 3 flow 3) — stage-driven. Renders the five stage kinds
 * grouped Design (exploration·spec) › Freeze › Build (plan·execute·review) from
 * the project's `stage` rows + `current_stage`. Per-stage glyph from status:
 * active → ◐, done → ●, pending → ○. Build stages show 🔒 while phase∈{design,
 * frozen}.
 *
 * Reachable ⟺ NOT locked AND status∈{active,done} → a focusable link to
 * `stageRoute`. pending (inert) + locked stages are aria-disabled, out of the
 * tab order, non-navigable. Status is never conveyed by colour alone — every
 * stage's accessible name carries its kind + status text (+ "locked").
 */

const STAGE_LABEL: Record<StageKind, string> = {
  exploration: 'Exploration',
  spec: 'Spec',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
};

const GROUPS: { group: 'design' | 'freeze' | 'build'; label: string; kinds: StageKind[] }[] = [
  { group: 'design', label: 'Design', kinds: ['exploration', 'spec'] },
  { group: 'freeze', label: 'Freeze', kinds: [] }, // freeze is a divider, not a stage row
  { group: 'build', label: 'Build', kinds: ['plan', 'execute', 'review'] },
];

const BUILD_KINDS: StageKind[] = ['plan', 'execute', 'review'];

function glyph(status: StageStatus): string {
  return status === 'done' ? '●' : status === 'active' ? '◐' : '○';
}

export interface StageStepperProps {
  projectId: string;
  /** The project's stage rows (kind → status). */
  stages: { kind: StageKind; status: StageStatus }[];
  /** The resume pointer — the highlighted/active stage. */
  currentStage: StageKind | null;
  /** The project phase — Build kinds are locked while design|frozen. */
  phase: ProjectPhase;
  /** Tablet: icons + active label only. */
  condensed?: boolean;
}

interface ComputedStage {
  kind: StageKind;
  label: string;
  status: StageStatus;
  locked: boolean;
  reachable: boolean;
  isCurrent: boolean;
  href: string;
  accessibleName: string;
}

function computeStage(
  kind: StageKind,
  statusByKind: Map<StageKind, StageStatus>,
  currentStage: StageKind | null,
  phase: ProjectPhase,
  projectId: string,
): ComputedStage {
  const status = statusByKind.get(kind) ?? 'pending';
  const locked = BUILD_KINDS.includes(kind) && (phase === 'design' || phase === 'frozen');
  const reachable = !locked && (status === 'active' || status === 'done');
  const isCurrent = currentStage === kind;
  const statusWord = locked ? 'locked' : status;
  return {
    kind,
    label: STAGE_LABEL[kind],
    status,
    locked,
    reachable,
    isCurrent,
    href: stageRoute(kind, projectId),
    accessibleName: `${STAGE_LABEL[kind]} — ${statusWord}`,
  };
}

function stepClasses(s: ComputedStage): string {
  return cn(
    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
    s.isCurrent && 'bg-surface text-accent-deep font-semibold shadow-sm',
    !s.isCurrent && s.status === 'done' && 'text-accent-deep font-medium',
    !s.isCurrent && s.status !== 'done' && 'text-ink-faint',
  );
}

function StagePill({ s, condensed }: { s: ComputedStage; condensed: boolean }) {
  const showLabel = !condensed || s.isCurrent;
  const inner = (
    <>
      <span aria-hidden="true">{s.locked ? '🔒' : glyph(s.status)}</span>
      {showLabel ? <span>{s.label}</span> : null}
    </>
  );
  const shared = {
    'data-stage': s.kind,
    'data-state': (s.locked ? 'locked' : s.status) as string,
    'data-reachable': s.reachable ? 'true' : 'false',
    'aria-label': s.accessibleName,
    'aria-current': s.isCurrent ? ('step' as const) : undefined,
    className: stepClasses(s),
  };

  if (s.reachable) {
    return (
      <Link href={s.href} {...shared}>
        {inner}
      </Link>
    );
  }
  // Inert (pending) + locked stages: not a link, aria-disabled, out of tab order.
  return (
    <span {...shared} aria-disabled="true">
      {inner}
    </span>
  );
}

export function StageStepper({
  projectId,
  stages,
  currentStage,
  phase,
  condensed = false,
}: StageStepperProps) {
  const statusByKind = new Map(stages.map((s) => [s.kind, s.status]));

  return (
    <nav
      aria-label="Stage progress"
      data-condensed={condensed ? 'true' : undefined}
      className="flex items-center gap-2"
    >
      {GROUPS.map(({ group, label, kinds }, gi) => (
        <div key={group} className="flex items-center gap-2">
          {gi > 0 ? (
            <span aria-hidden="true" className="text-line-strong">
              ›
            </span>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
              {label}
            </span>
            <div className="flex gap-1 rounded-full bg-accent-tint/60 p-1">
              {group === 'freeze' ? (
                <span data-stage="freeze" className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-ink-faint">
                  <span aria-hidden="true">❄</span>
                  {!condensed ? <span>Freeze</span> : null}
                </span>
              ) : (
                kinds.map((kind) => (
                  <StagePill
                    key={kind}
                    s={computeStage(kind, statusByKind, currentStage, phase, projectId)}
                    condensed={condensed}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ))}
    </nav>
  );
}
