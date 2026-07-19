import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui';

/**
 * The shared card SHAPES the left panel governs (they are distinct, not one Card):
 *   • StatCard       — Card + CardHeader(icon + title) + label/value rows (SummaryPhase style)
 *   • SelectableTile — a button[aria-pressed] toggle tile (spec-outline component picker)
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
  disabled = false,
  onClick,
}: {
  /** The base icon for the leading tile. The tile chrome + the selected→✓ flip are owned
   *  by this component; when `selected`, a Check replaces `icon`. Omit for no icon tile. */
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'focus-ring flex flex-col gap-2.5 rounded-[var(--r-md)] border p-3.5 text-left transition-colors',
        selected ? 'border-accent bg-accent-tint/25 shadow-sm' : 'border-line bg-surface hover:border-line-strong',
        disabled && 'cursor-default',
      )}
    >
      <div className="flex items-center gap-2.5">
        {icon !== undefined ? (
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-[8px] transition-colors',
              selected ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint',
            )}
          >
            {selected ? <Check className="size-4" /> : icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 font-semibold text-ink">{title}</span>
      </div>
      {meta}
    </button>
  );
}

