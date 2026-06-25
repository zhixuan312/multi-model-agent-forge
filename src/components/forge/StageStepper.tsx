import { Fragment } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';
import { stageRoute } from '@/projects/stage-route';
import { STAGE_SUBSTEPS } from '@/components/forge/stage-substeps';

const STAGE_LABEL: Record<StageKind, string> = {
  exploration: 'Explore',
  spec: 'Spec',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
  journal: 'Journal',
};

const ALL_STAGES: StageKind[] = ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'];

const STAGE_LAST_FALLBACK: Partial<Record<StageKind, string>> = {
  exploration: 'synthesize',
  spec: 'document',
  plan: 'validate',
};

export interface StageStepperProps {
  projectId: string;
  stages: { kind: StageKind; status: StageStatus; lastPhase?: string | null }[];
  currentStage: StageKind | null;
  phase: ProjectPhase;
  /** Stages where canMutate=false — shown as "locked" (done with lock overlay). */
  lockedStages?: StageKind[];
  condensed?: boolean;
  subSteps?: { key: string; label: string }[];
  activeSubPhase?: string;
  onSubStepClick?: (key: string) => void;
}

/**
 * Visual state of a stage:
 * - not_started: stage hasn't begun
 * - ongoing:     stage is the current active one (in progress)
 * - done:        completed, still editable
 * - locked:      completed, edits disabled (downstream work depends on it)
 */
type VisualState = 'not_started' | 'ongoing' | 'done' | 'locked';

interface ComputedStage {
  kind: StageKind;
  label: string;
  visual: VisualState;
  reachable: boolean;
  isCurrent: boolean;
  href: string;
  accessibleName: string;
}

function computeStage(
  kind: StageKind,
  statusByKind: Map<StageKind, StageStatus>,
  currentStage: StageKind | null,
  projectId: string,
  lockedSet: Set<StageKind>,
  lastPhaseByKind?: Map<StageKind, string | null>,
): ComputedStage {
  const status = statusByKind.get(kind) ?? 'pending';
  const isCurrent = currentStage === kind;

  let visual: VisualState;
  if (status === 'done' && lockedSet.has(kind)) visual = 'locked';
  else if (status === 'done') visual = 'done';
  else if (status === 'active') visual = 'ongoing';
  else visual = 'not_started';

  const reachable = status === 'active' || status === 'done';
  const stateWord = visual === 'not_started' ? 'not started' : visual;

  return {
    kind,
    label: STAGE_LABEL[kind],
    visual,
    reachable,
    isCurrent,
    href: (() => {
      const base = stageRoute(kind, projectId);
      if (isCurrent) return base;
      const lp = lastPhaseByKind?.get(kind) ?? STAGE_LAST_FALLBACK[kind];
      return lp ? `${base}?phase=${lp}` : base;
    })(),
    accessibleName: `${STAGE_LABEL[kind]} — ${stateWord}`,
  };
}

/* ── Indicators ────────────────────────────────────────────────────────── */

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5L5 9L9.5 3.5" />
    </svg>
  );
}

function StageIndicator({ s }: { s: ComputedStage }) {
  switch (s.visual) {
    case 'locked':
      return (
        <span className="relative flex size-5 items-center justify-center rounded-full bg-[var(--sage)]">
          <CheckIcon />
          <span className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-surface ring-1 ring-line">
            <Lock aria-hidden="true" className="size-2 text-ink-faint" />
          </span>
        </span>
      );
    case 'done':
      return (
        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--sage)]">
          <CheckIcon />
        </span>
      );
    case 'ongoing':
      if (s.isCurrent) {
        return (
          <span className="flex size-7 items-center justify-center rounded-full bg-accent/15 ring-2 ring-accent/30">
            <span className="size-3 rounded-full bg-accent" />
          </span>
        );
      }
      return (
        <span className="flex size-5 items-center justify-center">
          <span className="size-3 rounded-full border-2 border-accent" />
        </span>
      );
    case 'not_started':
    default:
      return (
        <span className="flex size-5 items-center justify-center">
          <span className="size-2.5 rounded-full border-2 border-line-strong" />
        </span>
      );
  }
}

/* ── Track line ────────────────────────────────────────────────────────── */

function TrackLine({ status }: { status: 'done' | 'active' | 'pending' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-0.5 w-full rounded-full',
        status === 'done' && 'bg-[var(--sage)]',
        status === 'active' && 'bg-accent/30',
        status === 'pending' && 'bg-line',
      )}
    />
  );
}

function trackLineStatus(left: ComputedStage, right: ComputedStage): 'done' | 'active' | 'pending' {
  const lDone = left.visual === 'done' || left.visual === 'locked';
  const rDone = right.visual === 'done' || right.visual === 'locked';
  if (lDone && rDone) return 'done';
  if (lDone || left.visual === 'ongoing') return 'active';
  return 'pending';
}

/* ── Stage node (indicator + label) ───────────────────────────────────── */

function StageNode({ s, condensed }: { s: ComputedStage; condensed: boolean }) {
  const showLabel = !condensed || s.isCurrent;
  const labelCls = cn(
    'text-xs font-medium whitespace-nowrap transition-colors mt-1.5',
    s.isCurrent && 'text-accent-deep font-semibold',
    !s.isCurrent && (s.visual === 'done' || s.visual === 'locked') && 'text-[var(--sage-deep)]',
    !s.isCurrent && s.visual === 'ongoing' && 'text-accent-deep',
    !s.isCurrent && s.visual === 'not_started' && 'text-ink-faint',
  );

  const inner = (
    <span className={cn('flex flex-col items-center', s.reachable && 'cursor-pointer')}>
      <StageIndicator s={s} />
      {showLabel ? <span className={labelCls}>{s.label}</span> : null}
    </span>
  );

  const shared = {
    'data-stage': s.kind,
    'data-state': s.visual,
    'data-reachable': s.reachable ? 'true' : 'false',
    'aria-label': s.accessibleName,
    'aria-current': s.isCurrent ? ('step' as const) : undefined,
  };

  if (s.reachable) {
    return (
      <Link href={s.href} {...shared} className="group">
        {inner}
      </Link>
    );
  }
  return (
    <span {...shared} aria-disabled="true">
      {inner}
    </span>
  );
}

/* ── Sub-phase track ──────────────────────────────────────────────────── */

function SubPhaseTrack({
  steps,
  active,
  onClick,
}: {
  steps: { key: string; label: string }[];
  active?: string;
  onClick?: (key: string) => void;
}) {
  const activeIdx = steps.findIndex((s) => s.key === active);

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((st, i) => {
        const isActive = st.key === active;
        const isDone = activeIdx >= 0 && i < activeIdx;
        const Tag = onClick ? 'button' : 'span';
        return (
          <Fragment key={st.key}>
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px w-5',
                  isDone ? 'bg-[var(--sage)]/40' : isActive ? 'bg-accent/30' : 'bg-line',
                )}
              />
            ) : null}
            <Tag
              {...(Tag === 'button' ? { type: 'button' as const, onClick: () => onClick?.(st.key) } : {})}
              data-substep={st.key}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                isActive && 'bg-accent/10 text-accent-deep',
                isDone && 'text-[var(--sage-deep)]',
                !isActive && !isDone && 'text-ink-faint',
                onClick && !isActive && 'hover:text-ink-soft hover:bg-surface-3 cursor-pointer',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  isActive && 'bg-accent',
                  isDone && 'bg-[var(--sage)]',
                  !isActive && !isDone && 'bg-line-strong',
                )}
              />
              {st.label}
            </Tag>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ── Main stepper ─────────────────────────────────────────────────────── */

const GRID_COLS = 'auto 1fr auto 1fr auto 1fr auto 1fr auto 1fr auto';

export function StageStepper({
  projectId,
  stages,
  currentStage,
  phase,
  lockedStages,
  condensed = false,
  subSteps,
  activeSubPhase,
  onSubStepClick,
}: StageStepperProps) {
  const statusByKind = new Map(stages.map((s) => [s.kind, s.status]));
  const lastPhaseByKind = new Map(stages.map((s) => [s.kind, s.lastPhase ?? null]));
  const lockedSet = new Set(lockedStages ?? []);
  const computed = ALL_STAGES.map((kind) =>
    computeStage(kind, statusByKind, currentStage, projectId, lockedSet, lastPhaseByKind),
  );
  const hasSubSteps = subSteps && subSteps.length > 0;
  const currentIdx = currentStage ? ALL_STAGES.indexOf(currentStage) : 0;
  const subPhaseCol = currentIdx * 2 + 1;
  const subPhaseSpan = Math.max(1, 12 - subPhaseCol);

  return (
    <nav
      aria-label="Stage progress"
      data-condensed={condensed ? 'true' : undefined}
      className="grid w-full items-start gap-y-1.5"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      {computed.flatMap((s, i) => {
        const items: React.ReactNode[] = [];
        if (i > 0) {
          const prev = computed[i - 1];
          const ptPx = (s.isCurrent || prev.isCurrent) ? 12 : 8;
          items.push(
            <div key={`line-${i}`} className="flex items-center self-start" style={{ paddingTop: ptPx }}>
              <TrackLine status={trackLineStatus(prev, s)} />
            </div>,
          );
        }
        items.push(
          <div key={s.kind} className="flex justify-center">
            <StageNode s={s} condensed={condensed} />
          </div>,
        );
        return items;
      })}

      {hasSubSteps ? (
        <div style={{ gridColumn: `${subPhaseCol} / span ${subPhaseSpan}`, gridRow: 2 }}>
          <SubPhaseTrack steps={subSteps} active={activeSubPhase} onClick={onSubStepClick} />
        </div>
      ) : null}
    </nav>
  );
}
