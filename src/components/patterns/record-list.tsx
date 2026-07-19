'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader } from '@/components/ui';

/**
 * The shared shape behind every filterable record list (Loops › Activity runs, Journal ›
 * Nodes, …): a Card with an optional header (title + action), an optional filter/search
 * toolbar, an optional count label, and a scrollable list of selectable RecordCards.
 * The toolbar and card contents are caller-supplied slots so one component serves lists
 * whose filters and record shapes differ, without any of them hand-rolling the frame.
 */
export function RecordList({ header, toolbar, countLabel, children, className }: {
  /** CardHeader content — a title and optional action button. Omit for no header. */
  header?: ReactNode;
  /** The filter / search row, pinned under the header with a divider. Omit for none. */
  toolbar?: ReactNode;
  /** A small "Runs (7)" style count above the list. Omit for none. */
  countLabel?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      {header ? <CardHeader>{header}</CardHeader> : null}
      {toolbar ? <div className="shrink-0 border-b border-line p-3">{toolbar}</div> : null}
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {countLabel ? (
          <span className="shrink-0 px-1 text-xs font-medium uppercase tracking-wide text-ink-faint">{countLabel}</span>
        ) : null}
        <ul className="flex flex-col gap-1.5">{children}</ul>
      </CardContent>
    </Card>
  );
}

/**
 * One selectable record in a RecordList — a bordered button carrying a metadata row
 * (`chips` on the left, optional `trailing` on the right), a `title`, and an optional
 * `detail` line (a timestamp, a tag row, …). Selection styling is owned here so every
 * list highlights the same way.
 */
export function RecordCard({ chips, trailing, title, detail, selected = false, onClick }: {
  chips?: ReactNode;
  trailing?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'focus-ring flex w-full flex-col gap-1 rounded-[var(--r-md)] border p-2.5 text-left transition-colors',
          selected ? 'border-accent bg-accent-tint/25' : 'border-line hover:bg-bg-sunk',
        )}
      >
        {chips || trailing ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</span>
            {trailing}
          </div>
        ) : null}
        <span className="text-sm text-ink">{title}</span>
        {detail}
      </button>
    </li>
  );
}
