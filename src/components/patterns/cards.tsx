import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui';

/**
 * The three shared card SHAPES the left panel governs (they are distinct, not one Card):
 *   • StatCard      — Card + CardHeader(icon + title) + label/value rows (SummaryPhase style)
 *   • SelectableTile — a button[aria-pressed] toggle tile (spec-outline / preset pickers)
 *   • StatusCard    — a bordered div whose border reacts to status (execute repo cards)
 * All content-agnostic; callers pass the content.
 */

/**
 * The grid stat cards sit in. Governed alongside the card because the two are one design:
 * cards in the same row SHARE A HEIGHT (the grid's default `stretch`), so a short card sits
 * level with a tall neighbour instead of leaving a ragged edge across the row. `StatCard`
 * fills that height and pins its footer to the bottom, so the extra space reads as part of
 * the card rather than as a gap under it.
 *
 * `className` is for the container's own behaviour (scrolling, flex sizing), not for
 * respelling the columns or the gap.
 */
export function StatCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>
      {children}
    </div>
  );
}

/** One label/value line in a stat card — used for both the rows and the footer total. */
export interface StatCardRow {
  label: ReactNode;
  value: ReactNode;
}

export function StatCard({
  icon,
  title,
  rows,
  footer,
}: {
  /** A bare lucide icon — the card owns its size and tint so callers can't drift. */
  icon?: ReactNode;
  title: ReactNode;
  rows: readonly StatCardRow[];
  /** The card's total. Rendered in the governed `CardFooter` — the tinted band that
   *  mirrors the header — pinned to the bottom, so every card closes the same way and
   *  a total never reads as just one more row. */
  footer?: StatCardRow;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon ? <span className="inline-flex text-accent [&_svg]:size-4">{icon}</span> : null}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">{r.label}</span>
            <span className="font-medium text-ink">{r.value}</span>
          </div>
        ))}
      </CardContent>
      {footer ? (
        <CardFooter className="text-sm">
          <span className="text-ink-soft">{footer.label}</span>
          <span className="font-semibold text-ink">{footer.value}</span>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function SelectableTile({
  icon,
  title,
  meta,
  selected = false,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'focus-ring flex flex-col gap-2 rounded-[var(--r-md)] border p-3.5 text-left transition-colors',
        selected ? 'border-accent bg-accent-tint/25 shadow-sm' : 'border-line hover:border-line-strong',
      )}
    >
      {icon}
      <p className="font-semibold text-ink">{title}</p>
      {meta}
    </button>
  );
}

export type StatusTone = 'sage' | 'accent' | 'rose' | 'amber' | 'neutral';

const STATUS_BORDER: Record<StatusTone, string> = {
  sage: 'border-sage',
  accent: 'border-accent',
  rose: 'border-rose',
  amber: 'border-amber',
  neutral: 'border-line',
};

export function StatusCard({
  title,
  tone = 'neutral',
  badge,
  children,
}: {
  title: ReactNode;
  tone?: StatusTone;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn('overflow-hidden rounded-[var(--r-lg)] border', STATUS_BORDER[tone])}>
      <div className="flex items-center justify-between gap-2 bg-surface-2 px-4 py-3">
        <span className="font-medium text-ink">{title}</span>
        {badge}
      </div>
      {children ? <div className="px-4 py-3">{children}</div> : null}
    </div>
  );
}
