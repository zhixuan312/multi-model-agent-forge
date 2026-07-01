'use client';

import { History } from 'lucide-react';
import { EmptyState, Eyebrow, Mono } from '@/components/ui';
import { opStyle } from '@/components/forge/journal/palette';
import type { LogEntry } from '@/journal/types';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format-date';

/**
 * The Write-log table (Spec 6). Renders `log.md` as a four-column table
 * (Date · Op · Node · Title), NEWEST-FIRST by reverse file (append) order (F6) —
 * day-granularity dates can't disambiguate same-day entries, so append order is
 * the tiebreak. An op outside `{create,refine,supersede,merge}` renders a neutral
 * grey badge (F18). The node id links into the Nodes view.
 */
export function WriteLogView({
  log,
  onNavigate,
}: {
  log: LogEntry[];
  onNavigate: (id: string) => void;
}) {
  if (log.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title="No team learnings yet"
        description="Learnings are recorded at project freeze, and the write-log lands here."
      />
    );
  }

  // Reverse the file (append) order → newest-first; index gives a stable key.
  const rows = log.map((e, i) => ({ e, i })).reverse();

  return (
    // Own, padding-free scroll container so the sticky header hugs the very top
    // (a padded scroller leaves a gap where rows peek above the header).
    // `border-separate` keeps sticky thead reliable; borders live on the cells.
    <div className="h-full overflow-y-auto px-5">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="text-left [&>th]:border-b [&>th]:border-line [&>th]:bg-surface [&>th]:pb-2 [&>th]:pt-3.5">
            <th scope="col" className="pr-3">
              <Eyebrow as="span" className="text-ink-faint">Date</Eyebrow>
            </th>
            <th scope="col" className="pr-3">
              <Eyebrow as="span" className="text-ink-faint">Op</Eyebrow>
            </th>
            <th scope="col" className="pr-3">
              <Eyebrow as="span" className="text-ink-faint">Node</Eyebrow>
            </th>
            <th scope="col">
              <Eyebrow as="span" className="text-ink-faint">Title</Eyebrow>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, i }) => {
            const s = opStyle(e.op);
            return (
              <tr
                key={`${e.id}-${i}`}
                data-testid={`log-row-${i}`}
                data-title={e.title}
                className="[&>td]:border-b [&>td]:border-line/60 [&>td]:py-2"
              >
                <td className="pr-3 whitespace-nowrap">
                  <Mono className="!text-xs text-ink-soft">{formatDateTime(e.date)}</Mono>
                </td>
                <td className="pr-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium',
                      s.cls,
                    )}
                  >
                    {e.op}
                  </span>
                </td>
                <td className="pr-3">
                  <button
                    type="button"
                    onClick={() => onNavigate(e.id)}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {e.id}
                  </button>
                </td>
                <td className="text-ink">{e.title}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
