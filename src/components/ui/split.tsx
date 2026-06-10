import { type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Split — a primary/aside two-pane layout. The main column is fluid
 * (`flex-1 min-w-0`); the `aside` is a fixed width at `lg+` and stacks below the
 * main on narrower screens. For pages with parallel content — list ∣ detail,
 * composer ∣ output, form ∣ summary — instead of stacking everything down one
 * column.
 *
 *   <Split aside={<Filters />} side="left">{results}</Split>
 *
 * Mobile order is always main-first; `side` only positions the aside at `lg+`.
 */
const GAP = { md: 'gap-6', lg: 'gap-8' } as const;

export interface SplitProps {
  /** The primary (fluid) column. */
  children: ReactNode;
  /** The secondary (fixed-width) column. */
  aside: ReactNode;
  /** Aside width at `lg+` (e.g. '320px'). */
  asideWidth?: string;
  /** Which side the aside sits on at `lg+`. */
  side?: 'left' | 'right';
  gap?: keyof typeof GAP;
  className?: string;
}

export function Split({
  children,
  aside,
  asideWidth = '320px',
  side = 'right',
  gap = 'lg',
  className,
}: SplitProps) {
  return (
    <div
      className={cn(
        'flex flex-col lg:flex-row',
        side === 'left' && 'lg:flex-row-reverse',
        GAP[gap],
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        className="w-full shrink-0 lg:w-[var(--aside-w)]"
        style={{ '--aside-w': asideWidth } as CSSProperties}
      >
        {aside}
      </aside>
    </div>
  );
}
