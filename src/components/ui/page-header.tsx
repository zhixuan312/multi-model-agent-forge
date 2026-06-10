import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Eyebrow, Display, Text } from '@/components/ui/typography';

/**
 * PageHeader — the standard top-of-page block: an optional mono `Eyebrow`
 * kicker, the serif `Display` title, an optional `description`, and a
 * right-aligned `actions` slot. One per screen.
 */
export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Display>{title}</Display>
        {description ? <Text className="max-w-2xl">{description}</Text> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}
