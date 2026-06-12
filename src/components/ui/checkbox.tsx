'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Checkbox — the canonical shadcn/Radix checkbox, themed to Forge. Controlled
 * with `checked` / `onCheckedChange` (the Radix idiom — not native `onChange`).
 * Fills with `accent` and shows a lucide check when checked.
 *
 *   <Checkbox checked={on} onCheckedChange={(v) => setOn(v === true)} />
 */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'focus-ring peer grid size-[18px] shrink-0 place-items-center rounded-[var(--r-sm)] border border-line-strong bg-surface',
        'transition-[background,border-color,box-shadow] duration-150 ease-[var(--ease-out)]',
        'hover:border-ink-faint',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center text-white">
        <Check aria-hidden strokeWidth={3} className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
