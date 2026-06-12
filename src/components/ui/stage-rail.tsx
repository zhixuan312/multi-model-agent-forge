import { cn } from '@/lib/cn';

/**
 * StageRail — a compact segmented progress bar showing position through a fixed
 * sequence of stages (done · active · pending). Colour is theme-driven (swaps
 * with `data-phase`) so it is NOT the accessible channel — each segment carries
 * an `aria-label` text alternative. Generic: the caller maps its domain stages
 * to `{status, label}` segments.
 */
export type StageRailStatus = 'done' | 'active' | 'pending';

export interface StageRailSegment {
  status: StageRailStatus;
  /** Accessible label for this segment (e.g. the stage name). */
  label?: string;
}

const SEG: Record<StageRailStatus, string> = {
  done: 'bg-[var(--rail-done,var(--sage))]',
  active: 'bg-[var(--rail-active,var(--accent))]',
  pending: 'bg-[var(--rail-pending,var(--line-strong))]',
};

export function StageRail({
  segments,
  className,
  'aria-label': ariaLabel = 'Stage progress',
}: {
  segments: StageRailSegment[];
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <ul aria-label={ariaLabel} className={cn('flex list-none gap-1 p-0', className)}>
      {segments.map((s, i) => (
        <li
          key={i}
          data-status={s.status}
          aria-label={s.label ? `${s.label}: ${s.status}` : s.status}
          className={cn('h-[5px] flex-1 rounded', SEG[s.status])}
        />
      ))}
    </ul>
  );
}
