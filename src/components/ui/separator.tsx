import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Separator — a hairline rule on the `--line` token. `orientation="vertical"`
 * needs a height from its container (e.g. inside a flex row).
 */
export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({ orientation = 'horizontal', className, ...rest }: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px self-stretch',
        className,
      )}
      {...rest}
    />
  );
}
