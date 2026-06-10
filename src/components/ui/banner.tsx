import { type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TextStrong, TextSm } from '@/components/ui/typography';

/**
 * Banner (a.k.a. Alert) — an inline message block. A tinted background, a
 * colored left accent rule, a leading status icon, a title and optional
 * description. Optionally dismissible and/or carries a trailing action slot.
 *
 * `info` uses the cool-world steel vars (no `--color-steel*` theme utility —
 * see token gaps); the rest use their semantic `*-tint` tokens.
 */
const bannerVariants = cva(
  'relative flex gap-3 overflow-hidden rounded-[var(--r-md)] border-l-2 py-3 pl-4 pr-3',
  {
    variants: {
      variant: {
        info: 'border-l-[var(--steel)] bg-[var(--frost)]',
        success: 'border-l-[var(--sage)] bg-sage-tint',
        warning: 'border-l-[var(--amber)] bg-amber-tint',
        danger: 'border-l-[var(--rose)] bg-rose-tint',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

const iconFor = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const iconTone: Record<NonNullable<VariantProps<typeof bannerVariants>['variant']>, string> = {
  info: 'text-[var(--steel-deep)]',
  success: 'text-[var(--sage-deep)]',
  warning: 'text-[var(--amber)]',
  danger: 'text-[var(--rose)]',
};

export interface BannerProps extends VariantProps<typeof bannerVariants> {
  title: ReactNode;
  description?: ReactNode;
  /** Trailing action slot (e.g. a Button). */
  action?: ReactNode;
  /** When provided, renders a dismiss button that calls this. */
  onDismiss?: () => void;
  className?: string;
}

export function Banner({
  variant = 'info',
  title,
  description,
  action,
  onDismiss,
  className,
}: BannerProps) {
  const v = variant ?? 'info';
  const Icon = iconFor[v];
  return (
    <div role="status" className={cn(bannerVariants({ variant }), className)}>
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', iconTone[v])} aria-hidden />
      <div className="min-w-0 flex-1">
        <TextStrong className="t-sm font-semibold !text-ink">{title}</TextStrong>
        {description ? <TextSm className="mt-0.5 !text-ink-soft">{description}</TextSm> : null}
        {action ? <div className="mt-2.5 flex items-center gap-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="focus-ring -mr-1 -mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-ink-faint transition-colors duration-150 ease-[var(--ease-out)] hover:bg-black/5 hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
