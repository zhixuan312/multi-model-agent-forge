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

export function StatCard({
  icon,
  title,
  rows,
  footer,
}: {
  icon?: ReactNode;
  title: ReactNode;
  rows: readonly { label: ReactNode; value: ReactNode }[];
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 !text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-ink-soft">{r.label}</span>
            <span className="font-medium text-ink">{r.value}</span>
          </div>
        ))}
      </CardContent>
      {footer ? <CardFooter className="text-xs text-ink-faint">{footer}</CardFooter> : null}
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
