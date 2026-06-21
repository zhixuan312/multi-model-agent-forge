import { Fragment } from 'react';
import Link from 'next/link';
import { Lock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';
import { stageRoute } from '@/projects/stage-route';
import { STAGE_SUBSTEPS } from '@/components/forge/stage-substeps';

/**
 * StageStepper (Spec 3 flow 3) — stage-driven. Renders into the LOCKED
 * `ShellSubNav` bar (the sub-nav owns the border / background), so this is a
 * clean horizontal stepper: the six stage kinds grouped Design (explore·spec·
 * plan) › Build (execute·review) › Learn (journal) as segmented pill links.
 * Current stage = accent, done = sage, locked = muted with a `Lock` glyph.
 *
 * Per-stage glyph from status: active → ◐, done → ● (sage), pending → ○. Build
 * and Learn stages show a `Lock` while phase is design (the DESIGN→BUILD handoff
 * — "Lock the plan" — opens them).
 *
 * Reachable ⟺ NOT locked AND status∈{active,done} → a focusable link to
 * `stageRoute`. pending (inert) + locked stages are aria-disabled, out of the
 * tab order, non-navigable. Status is never conveyed by colour alone — every
 * stage's accessible name carries its kind + status text (+ "locked").
 */

const STAGE_LABEL: Record<StageKind, string> = {
  exploration: 'Explore',
  spec: 'Spec',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
  journal: 'Journal',
};

const GROUPS: { group: 'design' | 'build' | 'learn'; label: string; kinds: StageKind[] }[] = [
  { group: 'design', label: 'Design', kinds: ['exploration', 'spec', 'plan'] },
  { group: 'build', label: 'Build', kinds: ['execute', 'review'] },
  { group: 'learn', label: 'Learn', kinds: ['journal'] },
];

/** Stages gated behind the DESIGN→BUILD handoff (locked while phase is design). */
const LOCKED_KINDS: StageKind[] = ['execute', 'review', 'journal'];

/** When revisiting a non-current stage, land on its furthest reached phase. */
const STAGE_LAST_FALLBACK: Partial<Record<StageKind, string>> = {
  exploration: 'synthesize',
  spec: 'document',
  plan: 'validate',
};

function glyph(status: StageStatus, kind?: StageKind, lastPhase?: string | null): string {
  if (status === 'done') return '●';
  if (status === 'pending') return '○';
  // Active — compute fractional fill from lastPhase
  if (!kind || !lastPhase) return '◐';
  const phases = STAGE_SUBSTEPS[kind];
  if (!phases || phases.length <= 1) return '◐';
  const idx = phases.findIndex((p) => p.key === lastPhase);
  if (idx < 0) return '◐';
  const fraction = (idx + 1) / phases.length;
  if (fraction <= 0.34) return '◔';
  if (fraction <= 0.67) return '◑';
  if (fraction < 1) return '◕';
  return '●';
}

export interface StageStepperProps {
  projectId: string;
  /** The project's stage rows (kind → status). */
  stages: { kind: StageKind; status: StageStatus; lastPhase?: string | null }[];
  /** The resume pointer — the highlighted/active stage. */
  currentStage: StageKind | null;
  /** The project phase — Build kinds are locked while design|frozen. */
  phase: ProjectPhase;
  /** Tablet: icons + active label only. */
  condensed?: boolean;
  /** Sub-phases of the current stage, rendered inline (expanded) after its pill. */
  subSteps?: { key: string; label: string }[];
  /** The active sub-phase key (highlighted within `subSteps`). */
  activeSubPhase?: string;
  /** When provided, sub-phase chips become clickable to jump to that phase. */
  onSubStepClick?: (key: string) => void;
}

/** Inline sub-phase stepper shown under the active stage (e.g. Outline › Craft › Document). */
function SubStepper({
  steps,
  active,
  onClick,
}: {
  steps: { key: string; label: string }[];
  active?: string;
  onClick?: (key: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-surface/70 p-0.5 ring-1 ring-inset ring-line">
      {steps.map((st, i) => {
        const isActive = st.key === active;
        const cls = cn(
          'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
          isActive ? 'bg-accent text-white' : 'text-ink-soft',
          onClick && !isActive && 'hover:bg-accent-tint hover:text-accent-deep',
        );
        return (
          <Fragment key={st.key}>
            {i > 0 ? <ChevronRight aria-hidden="true" className="size-3 text-line-strong" /> : null}
            {onClick ? (
              <button
                type="button"
                data-substep={st.key}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onClick(st.key)}
                className={cls}
              >
                {st.label}
              </button>
            ) : (
              <span data-substep={st.key} aria-current={isActive ? 'step' : undefined} className={cls}>
                {st.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}

interface ComputedStage {
  kind: StageKind;
  label: string;
  status: StageStatus;
  lastPhase: string | null;
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
  lastPhaseByKind?: Map<StageKind, string | null>,
): ComputedStage {
  const status = statusByKind.get(kind) ?? 'pending';
  const locked = LOCKED_KINDS.includes(kind) && phase === 'design';
  const reachable = !locked && (status === 'active' || status === 'done');
  const isCurrent = currentStage === kind;
  const statusWord = locked ? 'locked' : status;
  const lastPhase = lastPhaseByKind?.get(kind) ?? null;
  return {
    kind,
    label: STAGE_LABEL[kind],
    status,
    lastPhase,
    locked,
    reachable,
    isCurrent,
    href: (() => {
      const base = stageRoute(kind, projectId);
      if (isCurrent) return base;
      const lp = lastPhaseByKind?.get(kind) ?? STAGE_LAST_FALLBACK[kind];
      return lp ? `${base}?phase=${lp}` : base;
    })(),
    accessibleName: `${STAGE_LABEL[kind]} — ${statusWord}`,
  };
}

function stepClasses(s: ComputedStage): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
    s.isCurrent && 'bg-accent text-white shadow-sm',
    !s.isCurrent && s.locked && 'text-ink-faint',
    !s.isCurrent && !s.locked && s.status === 'done' && 'text-accent-deep hover:bg-accent-tint',
    !s.isCurrent && !s.locked && s.status === 'active' && 'text-accent-deep hover:bg-accent-tint',
    !s.isCurrent && !s.locked && s.status === 'pending' && 'text-ink-faint',
  );
}

function StagePill({ s, condensed }: { s: ComputedStage; condensed: boolean }) {
  const showLabel = !condensed || s.isCurrent;
  const inner = (
    <>
      {s.locked ? (
        <Lock aria-hidden="true" className="size-3" />
      ) : (
        <span aria-hidden="true">{glyph(s.status, s.kind, s.lastPhase)}</span>
      )}
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
  subSteps,
  activeSubPhase,
  onSubStepClick,
}: StageStepperProps) {
  const statusByKind = new Map(stages.map((s) => [s.kind, s.status]));
  const lastPhaseByKind = new Map(stages.map((s) => [s.kind, s.lastPhase ?? null]));

  return (
    <nav
      aria-label="Stage progress"
      data-condensed={condensed ? 'true' : undefined}
      className="flex w-full items-center gap-2"
    >
      {GROUPS.map(({ group, label, kinds }, gi) => (
        <div key={group} className="flex items-center gap-2">
          {gi > 0 ? (
            <ChevronRight aria-hidden="true" className="size-3.5 text-line-strong" />
          ) : null}
          <div className="flex items-center gap-2">
            <span className="t-eyebrow shrink-0 uppercase !text-ink-faint">{label}</span>
            <div className="flex items-center gap-0.5 rounded-full bg-surface/70 p-0.5 ring-1 ring-inset ring-line">
              {kinds.map((kind) => {
                const s = computeStage(kind, statusByKind, currentStage, phase, projectId, lastPhaseByKind);
                return (
                  <Fragment key={kind}>
                    <StagePill s={s} condensed={condensed} />
                    {s.isCurrent && subSteps && subSteps.length > 0 ? (
                      <SubStepper steps={subSteps} active={activeSubPhase} onClick={onSubStepClick} />
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </nav>
  );
}
