import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Toolbar — the filter/control strip above a list or grid. Lays its controls in
 * a wrapping row with consistent spacing and pushes an optional `actions` slot
 * (the page's primary action) to the right. Stacks controls above actions on
 * narrow screens. Replaces the cramped hand-rolled flex rows on the list pages.
 *
 *   <Toolbar actions={<Button>New</Button>}>
 *     <SearchInput /> <FilterPills /> <Toggle />
 *   </Toolbar>
 */
export interface ToolbarProps {
  /** Filters / controls (left, wrapping). */
  children: ReactNode;
  /** Right-aligned primary action(s). */
  actions?: ReactNode;
  /**
   * Cross-axis alignment of the controls. `center` (default) suits inline
   * controls (pills, an unlabelled search); `end` suits labelled `Field`s
   * (label above control) so the inputs line up along their bottoms.
   */
  align?: 'center' | 'end';
  className?: string;
}

export function Toolbar({ children, actions, align = 'center', className }: ToolbarProps) {
  const items = align === 'end' ? 'sm:items-end' : 'sm:items-center';
  const inner = align === 'end' ? 'items-end' : 'items-center';
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row', items, className)}>
      <div className={cn('flex flex-1 flex-wrap gap-2.5', inner)}>{children}</div>
      {actions ? <div className={cn('flex shrink-0 gap-2', inner)}>{actions}</div> : null}
    </div>
  );
}
