'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

/**
 * Tooltip — the canonical shadcn/Radix tooltip, themed to Forge. Radix handles
 * the portal (no clipping), collision-aware positioning, hover/focus triggers,
 * and open delay. Compose it the framework way:
 *
 *   <Tooltip>
 *     <TooltipTrigger asChild><IconButton …/></TooltipTrigger>
 *     <TooltipContent>Copy link</TooltipContent>
 *   </Tooltip>
 *
 * A `TooltipProvider` wraps the app (in the root layout) so individual tooltips
 * need no provider of their own; it is also re-exported here for local use.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function Tooltip({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root delayDuration={delayDuration} {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'forge-pop z-50 max-w-xs rounded-[var(--r-sm)] bg-ink px-2 py-1 text-[0.6875rem] font-medium text-[var(--surface)] shadow-[var(--shadow-pop)]',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-ink" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
