import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Heading } from '@/components/ui/typography';
import { Callout } from '@/components/ui/callout';

/** Section — a vertical grouping within a page. */
export function Section({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('space-y-4', className)} {...rest} />;
}

/**
 * SectionTitle — the header for a `Section`: a serif `Heading` with an optional
 * right-aligned `action`, and an optional `description`.
 *
 * The `description` renders inside a `Callout` (a contained note), never as bare
 * text on the page canvas — explanatory copy always sits in a deliberate
 * container. The title row stays clean; the note sits full-width beneath it.
 */
export interface SectionTitleProps {
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionTitle({ children, description, action, className }: SectionTitleProps) {
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-center justify-between gap-4">
        <Heading className="min-w-0 !text-lg">{children}</Heading>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {description ? <Callout>{description}</Callout> : null}
    </div>
  );
}
