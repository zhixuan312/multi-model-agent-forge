import type { ReactNode } from 'react';

/** Titled page header used by the placeholder routes + settings/profile pages. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A titled empty-state body for routes whose real content lands in a later spec. */
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid place-items-center rounded-[var(--r-lg)] border border-dashed border-line bg-surface-2 px-6 py-16 text-center">
      <p className="font-serif text-base italic text-ink-faint">{title}</p>
      <p className="mt-1 text-xs text-ink-faint">{hint}</p>
    </div>
  );
}
