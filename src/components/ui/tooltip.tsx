'use client';

import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { cloneElement } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tooltip — a lightweight hover/focus label. Wraps a single interactive child
 * (which must forward props + accept a ref-less DOM element); on hover or
 * keyboard focus it reveals a small popover and wires `aria-describedby`. No
 * portal — the popover is absolutely positioned relative to the wrapper.
 *
 *   <Tooltip label="Copy link"><IconButton …/></Tooltip>
 */
export interface TooltipProps {
  label: ReactNode;
  side?: 'top' | 'bottom';
  children: ReactElement<{
    'aria-describedby'?: string;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
  }>;
}

export function Tooltip({ label, side = 'top', children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const child = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      setOpen(true);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      setOpen(false);
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      setOpen(false);
    },
  });

  return (
    <span className="relative inline-flex">
      {child}
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[var(--r-sm)] bg-ink px-2 py-1 text-[0.6875rem] font-medium text-[var(--surface)] shadow-[var(--shadow-pop)]',
          'transition-opacity duration-150 ease-[var(--ease-out)]',
          open ? 'opacity-100' : 'opacity-0',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  );
}
