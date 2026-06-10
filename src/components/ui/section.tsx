import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Heading, TextSm } from '@/components/ui/typography';

/** Section — a vertical grouping within a page. */
export function Section({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('space-y-4', className)} {...rest} />;
}

/**
 * SectionTitle — the header row for a `Section`: a serif `Heading`, optional
 * `description`, and an optional right-aligned `action` slot.
 */
export interface SectionTitleProps {
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionTitle({ children, description, action, className }: SectionTitleProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        <Heading className="!text-lg">{children}</Heading>
        {description ? <TextSm>{description}</TextSm> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
