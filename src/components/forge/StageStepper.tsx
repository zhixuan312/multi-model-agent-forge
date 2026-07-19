import { Fragment } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';
import { STAGE_ORDER } from '@/db/enums';
import { stageRoute } from '@/projects/stage-route';
import { computeAllStages, type ComputedStageView } from '@/projects/stage-lifecycle';

const STAGE_LAST_FALLBACK: Partial<Record<StageKind, string>> = {
  exploration: 'synthesize',
  spec: 'finalize',
  plan: 'validate',
};

export interface StageStepperProps {
  projectId: string;
  stages: { kind: StageKind; status: StageStatus; lastPhase?: string | null }[];
  currentStage: StageKind | null;
  phase: ProjectPhase;
  lockedStages?: StageKind[];
  condensed?: boolean;
  subSteps?: { key: string; label: string }[];
  /** Per-phase status for the viewed stage (drives skipped/done sub-phase rendering). */
  subStepStatuses?: Record<string, string>;
  activeSubPhase?: string;
  onSubStepClick?: (key: string) => void;
}

interface StepperStage extends ComputedStageView {
  href: string;
  accessibleName: string;
}

function toStepperStages(
  computed: ComputedStageView[],
  projectId: string,
  currentStage: StageKind | null,
  lastPhaseByKind: Map<StageKind, string | null>,
): StepperStage[] {
  return computed.map((s) => {
    const base = stageRoute(s.kind, projectId);
    // Every project URL states its phase — `{stage}?phase={phase}` — including the stage
    // you're already on. Omitting it there left the address bar disagreeing with the
    // stepper until you clicked a chip, and made the landing phase unlinkable.
    const lp = lastPhaseByKind.get(s.kind) ?? STAGE_LAST_FALLBACK[s.kind];
    const href = lp ? `${base}?phase=${lp}` : base;
    const stateWord = s.visual === 'not_started' ? 'not started' : s.visual;
    return { ...s, href, accessibleName: `${s.label} — ${stateWord}` };
  });
}

/* ── Indicators ────────────────────────────────────────────────────────── */

function StageIndicator({ s }: { s: StepperStage }) {
  const base = 'flex size-6 items-center justify-center rounded-full';
  switch (s.visual) {
    case 'skipped':
      return (
        <span className={cn(base, 'border-2 border-dashed border-line-strong opacity-60')}>
          <span className="h-px w-2 bg-line-strong" />
        </span>
      );
    case 'not_started':
      return <span className={cn(base, 'border-2 border-line-strong')} />;
    case 'ongoing':
      return (
        <span className={cn(base, s.isCurrent ? 'border-2 border-accent bg-accent/15' : 'border-2 border-accent')}>
          <span className="size-2 rounded-full bg-accent" />
        </span>
      );
    case 'done':
      return (
        <span className={cn(base, 'bg-[var(--sage)]')}>
          <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6L5 8.5L9.5 3.5" />
          </svg>
        </span>
      );
    case 'locked':
      return (
        <span className={cn(base, 'bg-[var(--sage)]')}>
          <Lock aria-hidden="true" className="size-3 text-white" />
        </span>
      );
  }
}

/* ── Track line ────────────────────────────────────────────────────────── */

function TrackLine({ status }: { status: 'done' | 'active' | 'pending' | 'skipped' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-0.5 w-full rounded-full',
        status === 'done' && 'bg-[var(--sage)]',
        status === 'active' && 'bg-accent/30',
        status === 'pending' && 'bg-line',
        status === 'skipped' && 'bg-line-strong/30',
      )}
    />
  );
}

function trackLineStatus(left: StepperStage, right: StepperStage): 'done' | 'active' | 'pending' | 'skipped' {
  // A connector touching a skipped stage never represents completed work — grey it out
  // rather than drawing the green "done" line, which would read as real progress across
  // a stage the run bypassed.
  if (left.visual === 'skipped' || right.visual === 'skipped') return 'skipped';
  const lReached = left.visual === 'done' || left.visual === 'locked' || left.visual === 'ongoing';
  const rReached = right.visual === 'done' || right.visual === 'locked' || right.visual === 'ongoing';
  if (lReached && rReached) return 'done';
  if (lReached) return 'active';
  return 'pending';
}

/* ── Stage node ────────────────────────────────────────────────────────── */

function StageNode({ s, condensed }: { s: StepperStage; condensed: boolean }) {
  const showLabel = !condensed || s.isCurrent;
  const labelCls = cn(
    'text-xs font-medium whitespace-nowrap transition-colors mt-1.5',
    s.isCurrent && 'text-accent-deep font-semibold',
    !s.isCurrent && (s.visual === 'done' || s.visual === 'locked') && 'text-[var(--sage-deep)]',
    !s.isCurrent && s.visual === 'ongoing' && 'text-accent-deep',
    !s.isCurrent && s.visual === 'not_started' && 'text-ink-faint',
    !s.isCurrent && s.visual === 'skipped' && 'text-ink-faint line-through',
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
  furthest,
  statuses,
  onClick,
}: {
  steps: { key: string; label: string }[];
  active?: string;
  furthest?: string | null;
  /** Per-phase status from the project details. When present it is authoritative —
   *  `skipped` phases render struck-through and are non-navigable; only `done`/`active`
   *  phases are revisitable. Absent (a normal full-SDLC stage) → the index rule applies. */
  statuses?: Record<string, string>;
  onClick?: (key: string) => void;
}) {
  const activeIdx = steps.findIndex((s) => s.key === active);
  const furthestIdx = furthest ? steps.findIndex((s) => s.key === furthest) : -1;
  const highIdx = Math.max(activeIdx, furthestIdx);

  return (
    <div className="inline-flex items-center gap-1.5">
      {steps.map((st, i) => {
        const status = statuses?.[st.key];
        const isSkipped = status === 'skipped';
        const isActive = !isSkipped && st.key === active;
        const isDone = !isSkipped && !isActive && (status ? status === 'done' : highIdx >= 0 && i <= highIdx);
        const reachable = isSkipped
          ? false
          : status
            ? status === 'done' || status === 'active'
            : i <= highIdx || isActive;
        const canClick = Boolean(onClick) && reachable && !isActive;
        const Tag = canClick ? 'button' : 'span';
        return (
          <Fragment key={st.key}>
            {i > 0 ? (
              <span aria-hidden="true" className={cn('h-px w-5', isDone ? 'bg-[var(--sage)]/40' : isActive ? 'bg-accent/30' : 'bg-line')} />
            ) : null}
            <Tag
              {...(Tag === 'button' ? { type: 'button' as const, onClick: () => onClick?.(st.key) } : {})}
              data-substep={st.key}
              data-substate={status ?? undefined}
              aria-current={isActive ? 'step' : undefined}
              aria-disabled={isSkipped ? 'true' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                isActive && 'bg-accent/10 text-accent-deep',
                isDone && 'text-[var(--sage-deep)]',
                isSkipped && 'text-ink-faint line-through opacity-70',
                !isActive && !isDone && !isSkipped && 'text-ink-faint',
                canClick && 'hover:text-ink-soft hover:bg-surface-3 cursor-pointer',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  isActive && 'bg-accent',
                  isDone && 'bg-[var(--sage)]',
                  (isSkipped || (!isActive && !isDone)) && 'bg-line-strong',
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

// 6 stage columns (auto = fit content) + 5 line columns (1fr = fill gaps)
const GRID_COLS = 'auto 1fr auto 1fr auto 1fr auto 1fr auto 1fr auto';

export function StageStepper({
  projectId,
  stages,
  currentStage,
  lockedStages,
  condensed = false,
  subSteps,
  subStepStatuses,
  activeSubPhase,
  onSubStepClick,
}: StageStepperProps) {
  const lastPhaseByKind = new Map(stages.map((s) => [s.kind, s.lastPhase ?? null]));
  const computed = computeAllStages(stages, currentStage, lockedStages);
  const stepperStages = toStepperStages(computed, projectId, currentStage, lastPhaseByKind);
  const hasSubSteps = subSteps && subSteps.length > 0;
  const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : 0;
  // Stage i occupies grid column (i*2 + 1), 1-indexed
  const subCol = currentIdx * 2 + 1;

  return (
    <nav
      aria-label="Stage progress"
      data-condensed={condensed ? 'true' : undefined}
      className="grid w-full items-start gap-y-2"
      style={{ gridTemplateColumns: GRID_COLS, padding: '0 80px' }}
    >
      {/* Row 1: stages + track lines — each in its own grid cell */}
      {stepperStages.flatMap((s, i) => {
        const items: React.ReactNode[] = [];
        if (i > 0) {
          items.push(
            <div key={`line-${i}`} className="flex items-center" style={{ paddingTop: 10 }}>
              <TrackLine status={trackLineStatus(stepperStages[i - 1], s)} />
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

      {/* Row 2: sub-phases centered under the active stage's grid column.
          width:0 + overflow:visible prevents content from stretching the auto column. */}
      {hasSubSteps ? (
        <div
          className="flex justify-center overflow-visible"
          style={{ gridColumn: `${subCol}`, gridRow: 2, width: 0, justifySelf: 'center' }}
        >
          <SubPhaseTrack
            steps={subSteps}
            statuses={subStepStatuses}
            active={activeSubPhase || (currentStage ? lastPhaseByKind.get(currentStage) ?? undefined : undefined)}
            furthest={(() => {
              const viewing = computed.find((s) => s.isCurrent);
              if (viewing && (viewing.visual === 'done' || viewing.visual === 'locked')) {
                return subSteps[subSteps.length - 1]?.key ?? null;
              }
              return currentStage ? lastPhaseByKind.get(currentStage) ?? null : null;
            })()}
            onClick={onSubStepClick}
          />
        </div>
      ) : null}
    </nav>
  );
}
