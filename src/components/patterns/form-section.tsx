import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui';

/**
 * FormSection — the shared settings-form section: a card with a plain heading (+ optional
 * description), the fields as children (stacked or in a FieldGrid — the caller decides), and
 * an optional right-aligned footer action row. Content-agnostic; the container is governed.
 */
export function FormSection({
  heading,
  description,
  children,
  footer,
  className,
}: {
  heading: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-5 py-5">
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">{heading}</p>
          {description ? <p className="text-sm text-ink-soft">{description}</p> : null}
        </div>
        {children}
        {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
