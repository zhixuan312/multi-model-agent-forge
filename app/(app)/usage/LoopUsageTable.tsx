'use client';

import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, Repeat, ChevronRight } from 'lucide-react';
import {
  Button,
  Input,
  Title,
  EmptyState,
  DataTable,
} from '@/components/ui';
import { formatCost, formatDuration } from '@/usage/format';
import { RouteBreakdown } from './RouteBreakdown';
import type { LoopUsageRow, RouteAggRow } from '@/usage/usage-core';

export function LoopUsageTable({
  data,
  detailByLoop,
}: {
  data: LoopUsageRow[];
  detailByLoop: Record<string, RouteAggRow[]>;
}) {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  const columns = useMemo<ColumnDef<LoopUsageRow>[]>(
    () => [
      {
        id: 'loop',
        header: 'Loop',
        cell: ({ row }) => <span className="font-medium">{row.original.loopName}</span>,
      },
      {
        accessorKey: 'runCount',
        header: 'Runs',
        size: 70,
        cell: ({ row }) => <span className="tabular-nums">{row.original.runCount}</span>,
      },
      {
        accessorKey: 'costUsd',
        header: 'Cost',
        size: 90,
        cell: ({ row }) => <span className="tabular-nums">{formatCost(row.original.costUsd)}</span>,
      },
      {
        accessorKey: 'savedUsd',
        header: 'Saved',
        size: 90,
        cell: ({ row }) => (
          <span className="tabular-nums text-[var(--sage)]">{formatCost(row.original.savedUsd || null)}</span>
        ),
      },
      {
        id: 'avgCost',
        header: 'Avg/run',
        size: 90,
        cell: ({ row }) => {
          const avg = row.original.runCount > 0 ? row.original.costUsd / row.original.runCount : 0;
          return <span className="tabular-nums">{formatCost(avg)}</span>;
        },
      },
      {
        accessorKey: 'changedCount',
        header: 'Changed',
        size: 80,
        cell: ({ row }) => <span className="tabular-nums text-[var(--sage)]">{row.original.changedCount}</span>,
      },
      {
        accessorKey: 'noChangeCount',
        header: 'No changes',
        size: 90,
        cell: ({ row }) => <span className="tabular-nums text-ink-faint">{row.original.noChangeCount}</span>,
      },
      {
        accessorKey: 'durationMs',
        header: 'Agent hours',
        size: 100,
        cell: ({ row }) => <span className="tabular-nums">{formatDuration(row.original.durationMs)}</span>,
      },
      {
        id: 'expand',
        header: '',
        size: 48,
        cell: ({ row }) => {
          const isOpen = expandedId === row.original.loopId;
          return (
            <Button size="sm" variant="ghost" onClick={() => toggle(row.original.loopId)} aria-label="Expand">
              <ChevronRight className={`size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </Button>
          );
        },
      },
    ],
    [expandedId, toggle],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((r) => r.loopName.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div className="forge-spotlight flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))]">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Loop costs</Title>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input aria-label="Search loops" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search loops…" className="pl-9" />
          </div>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        fill
        getRowId={(r) => r.loopId}
        expandedId={expandedId}
        renderExpanded={(row) => <RouteBreakdown routes={detailByLoop[row.loopId] ?? []} />}
        emptyState={<EmptyState icon={<Repeat />} title="No loop activity" description="No loops have run in this period." />}
      />
    </div>
  );
}
