import { type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * NextActionPill — the "what do I do next?" affordance on a work-queue card. The
 * tone encodes urgency: `attention` (amber) when the project is blocked on a
 * human decision or audit finding, `normal` for an in-progress step, `done`
 * muted. Renders as a link when `href` is given. A leading arrow by default
 * (suppress with `icon={null}` or override).
 */
const pillVariants = cva(
  'inline-flex items-center gap-1.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-xs font-semibold [&_svg]:size-3.5 transition-colors duration-150 ease-[var(--ease-out)]',
  {
    variants: {
      tone: {
        attention: 'bg-amber-tint text-[var(--amber)] hover:bg-[var(--amber-tint-2,var(--amber-tint))]',
        normal: 'border border-line bg-surface-2 text-ink-soft hover:text-ink',
        info: 'bg-[var(--frost)] text-[var(--steel-deep)]',
        done: 'text-ink-faint',
      },
    },
    defaultVariants: { tone: 'normal' },
  },
);

export interface NextActionPillProps extends VariantProps<typeof pillVariants> {
  children: ReactNode;
  href?: string;
  /** Leading icon; defaults to an arrow. Pass `null` to omit. */
  icon?: ReactNode | null;
  className?: string;
}

export function NextActionPill({ children, href, icon, tone, className }: NextActionPillProps) {
  const lead = icon === undefined ? <ArrowRight aria-hidden /> : icon;
  const cls = cn(pillVariants({ tone }), href && 'focus-ring', className);
  const body = (
    <>
      {lead}
      <span>{children}</span>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}
