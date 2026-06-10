import { forwardRef, type InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Checkbox — a native checkbox kept for a11y, visually replaced by a square
 * that fills with `accent` and shows a lucide check when checked. The box and
 * the check are BOTH direct siblings of the `peer` input so `peer-checked:`
 * reaches each (it cannot target nested descendants).
 */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Checkbox({ className, disabled, ...rest }, ref) {
    return (
      <span className={cn('relative inline-flex size-[18px] shrink-0 align-middle', className)}>
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...rest}
        />
        {/* box */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[var(--r-sm)]',
            'border border-line-strong bg-surface',
            'transition-[background,border-color,box-shadow] duration-150 ease-[var(--ease-out)]',
            'peer-hover:border-ink-faint',
            'peer-checked:border-accent peer-checked:bg-accent',
            'peer-focus-visible:shadow-[var(--ring-offset),var(--ring)]',
            'peer-disabled:opacity-50',
          )}
        />
        {/* check mark */}
        <Check
          aria-hidden
          strokeWidth={3}
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-0 text-white',
            'transition-transform duration-150 ease-[var(--ease-spring)]',
            'peer-checked:scale-100',
            'peer-disabled:opacity-50',
          )}
        />
      </span>
    );
  },
);
