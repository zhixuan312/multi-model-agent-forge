'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/cn';

/**
 * DropdownMenu — the canonical shadcn/Radix dropdown, themed to Forge. Compose
 * it the framework way; Radix handles the portal (so the panel is never clipped
 * by an `overflow` ancestor), collision-aware positioning, roving focus, and
 * type-ahead.
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><IconButton …/></DropdownMenuTrigger>
 *     <DropdownMenuContent align="end">
 *       <DropdownMenuItem onSelect={…}><Pencil />Edit</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem variant="destructive" onSelect={…}><Trash2 />Delete</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'forge-pop z-50 min-w-[12rem] overflow-hidden rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps
  extends React.ComponentProps<typeof DropdownMenuPrimitive.Item> {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-variant={variant}
      className={cn(
        'focus-ring relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left text-sm outline-none',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-faint',
        inset && 'pl-8',
        variant === 'destructive'
          ? 'text-rose focus:bg-rose-tint data-[highlighted]:bg-rose-tint [&_svg]:text-rose'
          : 'text-ink-soft focus:bg-surface-2 focus:text-ink data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-2.5 py-1.5 font-mono text-[0.625rem] font-medium uppercase tracking-[0.06em] text-ink-faint',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-line', className)} {...props} />
  );
}
