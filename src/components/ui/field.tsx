import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/cn';
import { Label, Micro } from '@/components/ui/typography';

/**
 * Field — the labelled wrapper around a single form control. It owns the
 * accessibility wiring: the label's `htmlFor`, the control's `id`,
 * `aria-describedby` (hint + error), and `aria-invalid`. Pass the control as a
 * render-prop so Field can inject those props onto whatever element you supply:
 *
 *   <Field label="Email" hint="We never share it." error={err} required>
 *     {(p) => <Input type="email" {...p} />}
 *   </Field>
 */
export interface FieldProps {
  label: ReactNode;
  /** Supporting hint shown below the control (suppressed when an error shows). */
  hint?: ReactNode;
  /** Error message — when present the control turns rose + aria-invalid. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** Optional explicit id; otherwise a stable one is generated. */
  id?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: true;
    'aria-required'?: true;
  }) => ReactNode;
}

export function Field({ label, hint, error, required, className, id, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? auto;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={controlId} className="flex items-center gap-1">
        {label}
        {required ? (
          <span className="text-rose" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(required ? { 'aria-required': true } : {}),
      })}
      {error ? (
        <Micro id={errorId} role="alert" className="text-rose">
          {error}
        </Micro>
      ) : hint ? (
        <Micro id={hintId}>{hint}</Micro>
      ) : null}
    </div>
  );
}
