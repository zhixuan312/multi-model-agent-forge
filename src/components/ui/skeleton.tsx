import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Skeleton — a loading placeholder block with a subtle shimmer sweep (the
 * `forge-shimmer` keyframe in globals.css). Set width/height via className.
 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('forge-shimmer rounded-[var(--r-sm)] bg-surface-2', className)}
      {...rest}
    />
  );
}
