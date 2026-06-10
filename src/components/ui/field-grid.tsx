import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * FieldGrid — lays form fields in columns that collapse to a single column on
 * narrow screens, so forms read as structured rows instead of one tall stack of
 * full-width inputs. Wrap related `Field`s; a field can span the full row with
 * `className="sm:col-span-2"`.
 *
 *   <FieldGrid cols={2}>
 *     <Field label="First name">{(p) => <Input {...p} />}</Field>
 *     <Field label="Last name">{(p) => <Input {...p} />}</Field>
 *   </FieldGrid>
 */
const COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const;

export interface FieldGridProps extends HTMLAttributes<HTMLDivElement> {
  cols?: keyof typeof COLS;
}

export function FieldGrid({ cols = 2, className, children, ...rest }: FieldGridProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-4', COLS[cols], className)} {...rest}>
      {children}
    </div>
  );
}
