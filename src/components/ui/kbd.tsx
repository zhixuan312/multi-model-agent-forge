import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Kbd — a keyboard-key chip for shortcut hints (e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>). */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.5rem] items-center justify-center rounded-[var(--r-sm)] border border-line-strong border-b-2 bg-surface-2 px-1.5 py-0.5',
        'font-mono text-[0.6875rem] font-medium leading-none text-ink-soft',
        className,
      )}
      {...rest}
    />
  );
}
