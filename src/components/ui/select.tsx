'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fieldBase, fieldSingleLine } from '@/components/ui/field-styles';

/**
 * Select — the canonical shadcn/Radix select, themed to Forge. Compose it the
 * framework way; Radix handles the portal, keyboard, type-ahead, and aria.
 *
 *   <Select value={v} onValueChange={setV}>
 *     <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="a">A</SelectItem>
 *       <SelectItem value="b">B</SelectItem>
 *     </SelectContent>
 *   </Select>
 *
 * Note: Radix forbids an empty-string item value. For an "All / none" choice use
 * a sentinel value (e.g. "__all") and map it to your empty state.
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        fieldBase,
        fieldSingleLine,
        'flex cursor-pointer items-center justify-between gap-2 pr-3 text-left',
        'data-[placeholder]:text-ink-faint disabled:cursor-not-allowed',
        '[&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'forge-pop z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-hidden rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]',
          position === 'popper' &&
            'w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="grid place-items-center py-1 text-ink-faint">
          <ChevronUp className="size-4" aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="grid place-items-center py-1 text-ink-faint">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2.5 py-1.5 font-mono text-[0.625rem] font-medium uppercase tracking-[0.06em] text-ink-faint',
        className,
      )}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-[var(--r-sm)] py-1.5 pl-2.5 pr-8 text-sm text-ink-soft outline-none',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink',
        'data-[state=checked]:font-medium data-[state=checked]:text-ink',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2.5 grid place-items-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-accent" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}
