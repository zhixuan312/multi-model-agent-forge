import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Heading, Text } from '@/components/ui/typography';

/** Section — a vertical grouping within a page. */
export function Section({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('space-y-4', className)} {...rest} />;
}

/**
 * SectionTitle — the header for a `Section`: a serif `Heading` with an optional
 * right-aligned `action`, and an optional `description`.
 *
 * The `description` is a muted lead tucked DIRECTLY under the heading (tight
 * spacing = proximity grouping), not a boxed note. Per the content-layout
 * research, a section intro reads cleanest as quiet copy grouped with its title;
 * a border box around it just adds a competing "false floor". (For an actual
 * warning/alert, use `Banner` — that earns its container.)
 */
export interface SectionTitleProps {
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionTitle({ children, description, action, className }: SectionTitleProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-4">
        <Heading className="min-w-0 !text-lg">{children}</Heading>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {description ? <Text className="max-w-[68ch] !text-sm">{description}</Text> : null}
    </div>
  );
}
