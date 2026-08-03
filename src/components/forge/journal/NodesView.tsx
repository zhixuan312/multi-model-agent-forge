'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { StatusBadge } from '@/components/forge/journal/StatusBadge';
import { SearchInput } from '@/components/ui/search-input';
import { STATUS_VALUES } from '@/journal/types';
import type { NodeSummary } from '@/journal/types';
import { cn } from '@/lib/cn';
import { CategoryChip, categoryStyle } from '@/components/forge/journal/category-style';
import { LEARNING_CATEGORIES } from '@/db/enums';


/**
 * The Nodes index column (Spec 6). A searchable/filterable/sortable list of node
 * summaries. Search is a case-insensitive substring match against the title AND
 * each tag value independently (F2). The status filter is the full set
 * (All + the four known statuses). Sort defaults to id-ascending and toggles to
 * descending (F14). Bodies are NOT here — selecting a row lazy-loads the detail.
 */
export function NodesView({
  nodes,
  skippedCount,
  selectedId,
  onSelect,
}: {
  nodes: NodeSummary[];
  skippedCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  // Default to adopted (live learnings); status filter is collapsed behind a toggle.
  const [statusFilter, setStatusFilter] = useState<string>('adopted');
  const [showStatus, setShowStatus] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [desc, setDesc] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = nodes.filter((n) => {
      if (statusFilter !== 'All' && n.status !== statusFilter) return false;
      if (categoryFilter !== 'All' && n.type !== categoryFilter) return false;
      if (!q) return true;
      if (n.title.toLowerCase().includes(q)) return true;
      return n.tags.some((t) => t.toLowerCase().includes(q));
    });
    rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    if (desc) rows.reverse();
    return rows;
  }, [nodes, search, statusFilter, categoryFilter, desc]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        {/* The governed search control. This was a hand-rolled input with its own
            border, padding and focus treatment — the convention SearchInput exists to own. */}
        <SearchInput label="title or tags" value={search} onChange={setSearch} className="min-w-0 flex-none" />
        {/* Category — the primary filter axis, always visible. */}
        <div role="radiogroup" aria-label="Filter by category" className="flex flex-wrap items-center gap-1">
          {(['All', ...LEARNING_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              onClick={() => setCategoryFilter(c)}
              aria-checked={categoryFilter === c}
              className={cn(
                'rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] capitalize',
                categoryFilter === c
                  ? c === 'All'
                    ? 'border-accent bg-accent-tint text-accent-deep'
                    : cn('border-transparent', categoryStyle(c))
                  : 'border-line text-ink-soft hover:border-line-strong',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Status (collapsed, defaults to adopted) on the left · sort on the right. */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowStatus((s) => !s)}
            aria-expanded={showStatus}
            className="flex items-center gap-1 rounded-[var(--r-sm)] px-0.5 text-[11px] text-ink-faint hover:text-ink-soft"
          >
            <span>
              Status: <span className="font-medium capitalize text-ink-soft">{statusFilter}</span>
            </span>
            <ChevronDown className={cn('size-3 transition-transform', showStatus && 'rotate-180')} />
          </button>
          <button
            type="button"
            onClick={() => setDesc((d) => !d)}
            className="shrink-0 rounded-[var(--r-sm)] border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:border-line-strong"
            aria-label={`Sort by id ${desc ? 'descending' : 'ascending'}`}
          >
            sort {desc ? '↓' : '↑'}
          </button>
        </div>
        {showStatus ? (
          <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap items-center gap-1">
            {['All', ...STATUS_VALUES].map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                onClick={() => setStatusFilter(s)}
                aria-checked={statusFilter === s}
                className={cn(
                  'rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px]',
                  statusFilter === s
                    ? 'border-accent bg-accent-tint text-accent-deep'
                    : 'border-line text-ink-soft hover:border-line-strong',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {skippedCount > 0 ? (
          <p className="text-[11px] text-amber" role="status">
            {skippedCount} node(s) could not be parsed
          </p>
        ) : null}
      </div>

      <ul className="-mr-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {filtered.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              data-testid={`node-row-${n.id}`}
              onClick={() => onSelect(n.id)}
              aria-current={selectedId === n.id}
              className={cn(
                'flex w-full flex-col gap-1 rounded-[var(--r-sm)] border px-2 py-1.5 text-left',
                selectedId === n.id
                  ? 'border-accent bg-accent-tint'
                  : 'border-transparent hover:bg-surface-2',
              )}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-ink-faint">{n.id}</span>
                {n.type ? <CategoryChip category={n.type} size="sm" /> : null}
                <StatusBadge status={n.status} />
                {n.fileMissing ? (
                  // `store-reader` lists index rows whose node file is gone and sets this
                  // flag to "flag missing" — but nothing rendered it, so a broken entry
                  // looked identical to a healthy one. Text label, never colour alone.
                  <span
                    title="This entry is in the journal index but its node file is missing."
                    className="rounded-[var(--r-sm)] border border-[var(--rose)]/40 bg-rose-tint px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--rose)]"
                  >
                    file missing
                  </span>
                ) : null}
              </span>
              <span className="text-sm text-ink">{n.title}</span>
              {n.tags.length ? (
                <span className="flex flex-wrap gap-1">
                  {n.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-[var(--r-sm)] bg-surface-2 px-1 py-0.5 text-[10px] text-ink-soft"
                    >
                      {t}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-2 py-4 text-xs text-ink-faint">No nodes match.</li>
        ) : null}
      </ul>
    </div>
  );
}
