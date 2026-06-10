import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Callout — a quiet, contained note for explanatory / instructional copy.
 *
 * Help text must never float directly on the page canvas; it lives here: a
 * subtle surface panel with a hairline border, muted body text, and an optional
 * leading icon. Distinct from `Banner` (a colored, titled ALERT) — Callout is
 * neutral and unobtrusive, for orientation and guidance, not status.
 *
 *   <Callout>Leave the key blank to use the provider default.</Callout>
 *   <Callout icon={<Info />}>…</Callout>
 */
export function Callout({
  icon,
  children,
  className,
}: {
  /** Optional leading icon (sized + tinted automatically). */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-3.5 py-2.5',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="mt-px shrink-0 text-ink-faint [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <div className="t-sm min-w-0 text-ink-soft [&_a]:text-accent [&_a:hover]:underline">
        {children}
      </div>
    </div>
  );
}
