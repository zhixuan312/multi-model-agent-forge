'use client';

import { History } from 'lucide-react';
import { EmptyState, Eyebrow, Mono } from '@/components/ui';
import { opStyle } from '@/components/forge/journal/palette';
import type { LogEntry } from '@/journal/types';
import { cn } from '@/lib/cn';

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
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left">
          <th scope="col" className="py-2 pr-3">
            <Eyebrow as="span" className="text-ink-faint">Date</Eyebrow>
          </th>
          <th scope="col" className="py-2 pr-3">
            <Eyebrow as="span" className="text-ink-faint">Op</Eyebrow>
          </th>
          <th scope="col" className="py-2 pr-3">
            <Eyebrow as="span" className="text-ink-faint">Node</Eyebrow>
          </th>
          <th scope="col" className="py-2">
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
              className="border-b border-line/60"
            >
              <td className="py-2 pr-3">
                <Mono className="!text-xs text-ink-soft">{e.date}</Mono>
              </td>
              <td className="py-2 pr-3">
                <span
                  className={cn(
                    'inline-flex items-center rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium',
                    s.cls,
                  )}
                >
                  {e.op}
                </span>
              </td>
              <td className="py-2 pr-3">
                <button
                  type="button"
                  onClick={() => onNavigate(e.id)}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {e.id}
                </button>
              </td>
              <td className="py-2 text-ink">{e.title}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
