import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { fieldBase, fieldSingleLine } from '@/components/ui/field-styles';

/** Single-line text input. Pair with `Field` for label + error wiring. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = 'text', ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(fieldBase, fieldSingleLine, className)}
        {...rest}
      />
    );
  },
);
