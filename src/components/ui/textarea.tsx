import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { fieldBase } from '@/components/ui/field-styles';

/** Multi-line text input. Shares the field look; grows with `rows`. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(fieldBase, 'min-h-[4.5rem] resize-y px-3 py-2 leading-relaxed', className)}
        {...rest}
      />
    );
  },
);
