import { type HTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * MetricCard — one cell of the Status section: a tinted-circle icon, a mono
 * uppercase label, a serif value, and an optional sublabel caption. Number +
 * label only — no trend lines (we don't track historical counts, so a sparkline
 * would be fabricated).
 *
 *   tone="attention"  amber — reserved for action-needed metrics (Waiting for human)
 *   muted             zero state ("0 audit issues is good news, don't shout it")
 *   iconTint          decorative circle colour (accent · rose · sage · steel · neutral)
 */
const metricVariants = cva('flex items-start gap-3.5 rounded-[var(--r-md)] border px-4 py-3.5', {
  variants: {
    tone: {
      neutral: 'border-line bg-surface',
      attention: 'border-transparent bg-amber-tint',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

const ICON_TINT = {
  accent: 'bg-accent-tint text-accent',
  rose: 'bg-rose-tint text-[var(--rose)]',
  sage: 'bg-sage-tint text-[var(--sage)]',
  steel: 'bg-[var(--frost)] text-[var(--steel)]',
  amber: 'bg-amber-tint text-[var(--amber)]',
  neutral: 'bg-surface-2 text-ink-faint',
} as const;

export interface MetricCardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof metricVariants> {
  label: ReactNode;
  value: ReactNode;
  /** A lucide icon, rendered in a tinted circle. */
  icon?: ReactNode;
  /** A caption under the value (e.g. "Total members"). */
  sublabel?: ReactNode;
  /** Decorative circle colour for the icon. */
  iconTint?: keyof typeof ICON_TINT;
  /** Zero / idle state — dims the value. */
  muted?: boolean;
}

export function MetricCard({
  label,
  value,
  icon,
  sublabel,
  tone,
  iconTint = 'neutral',
  muted,
  className,
  ...rest
}: MetricCardProps) {
  const attention = tone === 'attention';
  return (
    <div className={cn(metricVariants({ tone }), className)} {...rest}>
      {icon ? (
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]',
            attention ? 'bg-[color-mix(in_oklab,var(--amber)_18%,transparent)] text-[var(--amber)]' : ICON_TINT[iconTint],
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            'font-mono text-[0.625rem] font-medium uppercase tracking-[0.06em]',
            attention ? 'text-[var(--amber)]' : 'text-ink-faint',
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'mt-1 font-serif text-[1.75rem] font-semibold leading-none',
            attention ? 'text-[var(--amber)]' : muted ? 'text-ink-faint' : 'text-ink',
          )}
        >
          {value}
        </span>
        {sublabel ? <span className="mt-1.5 t-micro text-ink-faint">{sublabel}</span> : null}
      </div>
    </div>
  );
}

/**
 * MetricRow — the Status-section container. Auto-fits as many `min`-wide cells as
 * the row allows (5 metrics on Projects, 4 on Workspace/Members), wrapping down on
 * narrow screens.
 */
export function MetricRow({
  min = '170px',
  className,
  children,
  style,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { min?: string }) {
  return (
    <div
      className={cn('grid gap-3', className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}, 100%), 1fr))`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
