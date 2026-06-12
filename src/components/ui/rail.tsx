import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Heading } from '@/components/ui/typography';

/**
 * Rail primitives — the building blocks of the attention/context RAIL section.
 * Each panel self-omits when it has nothing to show (the caller renders nothing),
 * so an empty rail collapses and the primary surface spans full width.
 *
 *   <RailPanel title="Needs your attention">
 *     <RailItem icon={<CircleAlert/>}>…</RailItem>
 *   </RailPanel>
 */
export function RailPanel({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-6', className)}>
      <Heading className="mb-2 !text-[0.95rem]">{title}</Heading>
      {children}
    </section>
  );
}

/** One row in a rail panel — a leading icon + content, hairline-separated. */
export function RailItem({
  icon,
  href,
  children,
  className,
}: {
  icon?: ReactNode;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {icon ? (
        <span aria-hidden className="mt-px shrink-0 [&_svg]:size-[15px]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
    </>
  );
  const base = cn(
    'flex gap-2.5 border-t border-line py-2.5 t-sm text-ink-soft first:border-t-0 first:pt-0',
    href && 'rounded-sm transition-colors duration-150 ease-[var(--ease-out)] hover:text-ink focus-ring',
    className,
  );
  return href ? (
    <a href={href} className={base}>
      {inner}
    </a>
  ) : (
    <div className={base}>{inner}</div>
  );
}

/** A quiet contained note — a product rule or tip. */
export function GuidanceCard({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3 t-sm text-ink-soft shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))]',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="mt-px shrink-0 text-ink-faint [&_svg]:size-[15px]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
