'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

/**
 * Switch — the canonical shadcn/Radix toggle, themed to Forge. Controlled with
 * `checked` / `onCheckedChange` (the Radix idiom). The track fills with `accent`
 * and the thumb slides on checked. Use for binary on/off settings; use
 * `Checkbox` for selecting within a set.
 *
 *   <Switch checked={on} onCheckedChange={setOn} />
 */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'focus-ring peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent',
        'bg-line-strong transition-colors duration-150 ease-[var(--ease-out)]',
        'data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-surface shadow-sm ring-0',
          'transition-transform duration-150 ease-[var(--ease-spring)]',
          'translate-x-0.5 data-[state=checked]:translate-x-[18px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
