'use client';

import { cn } from '@/lib/cn';

/**
 * A small segmented control — a horizontal radiogroup for two or three mutually exclusive
 * choices (dialect, worker tier, sign-in mode), where a `Select` would be heavier than the
 * choice deserves.
 *
 * There were two near-identical copies of this: one private to the Models panel and one
 * exported from `LoopForm` that nobody imported. They rendered the same markup and classes;
 * only the Loop copy carried the accessibility attributes. This is that version.
 *
 * `label` is REQUIRED, not optional: a radiogroup with no accessible name is announced as an
 * unlabelled group, and the copy that omitted it is exactly how that happens.
 */
export function Segmented({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  /** Accessible name for the group, e.g. "Worker tier". */
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit rounded-[var(--r-md)] border border-line bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-label={o.label}
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'focus-ring rounded-[calc(var(--r-md)-2px)] px-3 py-1 text-sm transition-colors',
            value === o.value ? 'bg-accent-tint font-medium text-accent-deep' : 'text-ink-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
