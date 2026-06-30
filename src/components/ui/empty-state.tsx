import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Heading, TextSm } from '@/components/ui/typography';

/**
 * EmptyState — the "nothing here yet" placeholder. A tinted circle holding a
 * lucide icon, a serif `Heading`, a line of supporting `TextSm`, and an
 * optional action (typically a Button). Sits on a dashed-border card.
 */
export interface EmptyStateProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-1 inline-flex size-12 items-center justify-center rounded-full bg-accent-tint text-accent-deep [&_svg]:size-6"
      >
        {icon}
      </span>
      <Heading className="!text-base">{title}</Heading>
      {description ? <TextSm className="max-w-sm">{description}</TextSm> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
