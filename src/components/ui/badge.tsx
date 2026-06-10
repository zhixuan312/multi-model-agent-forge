import { type HTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Badge — a pill for status / category labels. Each variant pairs a `*-tint`
 * background with its strong foreground. `dot` prefixes a small status dot;
 * `icon` slots a leading lucide icon. Keep these terse — one or two words.
 *
 * NB: the `steel` variant uses the cool-world raw vars directly because the
 * foundation exposes no `--color-steel*` theme utilities (see token gaps).
 */
const badgeVariants = cva(
  'inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-full font-medium leading-none',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-2 text-ink-soft ring-1 ring-inset ring-line',
        accent: 'bg-accent-tint text-accent-deep',
        sage: 'bg-sage-tint text-[var(--sage-deep)]',
        amber: 'bg-amber-tint text-[var(--amber)]',
        rose: 'bg-rose-tint text-[var(--rose)]',
        steel: 'bg-[var(--frost)] text-[var(--steel-deep)]',
      },
      size: {
        sm: 'h-5 px-2 text-[0.6875rem] [&_svg]:size-3',
        md: 'h-6 px-2.5 text-xs [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

const dotColor: Record<NonNullable<VariantProps<typeof badgeVariants>['variant']>, string> = {
  neutral: 'bg-ink-faint',
  accent: 'bg-accent',
  sage: 'bg-[var(--sage)]',
  amber: 'bg-[var(--amber)]',
  rose: 'bg-[var(--rose)]',
  steel: 'bg-[var(--steel)]',
};

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading status dot tinted to the variant. */
  dot?: boolean;
  /** Leading lucide icon. */
  icon?: ReactNode;
}

export function Badge({ className, variant, size, dot, icon, children, ...rest }: BadgeProps) {
  const v = variant ?? 'neutral';
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...rest}>
      {dot ? <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dotColor[v])} /> : null}
      {icon ? (
        <span aria-hidden className="-ml-0.5 inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
