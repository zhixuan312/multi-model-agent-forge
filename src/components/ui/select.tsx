import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fieldBase, fieldSingleLine } from '@/components/ui/field-styles';

/**
 * Select — a styled native `<select>`. We keep the native control (full
 * keyboard + platform a11y) and overlay a lucide `ChevronDown`, hiding the
 * default OS arrow via `appearance-none`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            fieldBase,
            fieldSingleLine,
            'cursor-pointer appearance-none pr-9',
            'disabled:cursor-not-allowed',
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
      </div>
    );
  },
);
