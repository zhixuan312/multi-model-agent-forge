'use client';

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
      <div className="grid place-items-center rounded-[var(--r-lg)] border border-dashed border-line bg-surface-2 px-6 py-16 text-center">
        <p className="font-serif text-base italic text-ink-faint">No team learnings yet</p>
        <p className="mt-1 text-xs text-ink-faint">Recorded at project freeze.</p>
      </div>
    );
  }

  // Reverse the file (append) order → newest-first; index gives a stable key.
  const rows = log.map((e, i) => ({ e, i })).reverse();

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
          <th scope="col" className="py-2 pr-3 font-semibold">
            Date
          </th>
          <th scope="col" className="py-2 pr-3 font-semibold">
            Op
          </th>
          <th scope="col" className="py-2 pr-3 font-semibold">
            Node
          </th>
          <th scope="col" className="py-2 font-semibold">
            Title
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
              <td className="py-2 pr-3 font-mono text-xs text-ink-soft">{e.date}</td>
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
