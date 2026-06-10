import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Switch — an accessible toggle built on a native checkbox (role kept native).
 * The track fills with `accent` and the thumb slides on checked. Use for
 * binary on/off settings; use `Checkbox` for selecting within a set.
 *
 * The input is the `peer`; the track and the thumb are BOTH direct siblings of
 * it so `peer-checked:` reaches each (it cannot reach nested descendants).
 */
export const Switch = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Switch({ className, disabled, ...rest }, ref) {
    return (
      <span className={cn('relative inline-flex h-5 w-9 shrink-0 align-middle', className)}>
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          disabled={disabled}
          className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...rest}
        />
        {/* track */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full',
            'bg-line-strong transition-colors duration-150 ease-[var(--ease-out)]',
            'peer-checked:bg-accent',
            'peer-focus-visible:shadow-[var(--ring-offset),var(--ring)]',
            'peer-disabled:opacity-50',
          )}
        />
        {/* thumb */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-surface shadow-sm',
            'transition-transform duration-150 ease-[var(--ease-spring)]',
            'peer-checked:translate-x-4',
            'peer-disabled:opacity-50',
          )}
        />
      </span>
    );
  },
);
