import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Grid — a responsive card/item grid that FILLS wide screens. Columns are
 * `auto-fill minmax(min, 1fr)`: as many `min`-wide columns as fit, each
 * stretching to share the row. No breakpoint guessing — it reflows from 1 col
 * on a phone to N cols on a wide display automatically. The `min(min, 100%)`
 * guard stops a single card from overflowing on very narrow viewports.
 *
 *   <Grid min="320px">{cards}</Grid>
 *
 * Replaces ad-hoc `grid grid-cols-1 md:grid-cols-2` scattered across list pages.
 */
const GAP = { sm: 'gap-3', md: 'gap-4', lg: 'gap-6' } as const;

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Minimum column width before another column wraps in (e.g. '320px'). */
  min?: string;
  gap?: keyof typeof GAP;
}

export function Grid({ min = '300px', gap = 'md', className, style, children, ...rest }: GridProps) {
  return (
    <div
      className={cn('grid', GAP[gap], className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}, 100%), 1fr))`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
