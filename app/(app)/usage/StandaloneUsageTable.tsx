'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, Zap } from 'lucide-react';
import {
  Input,
  Title,
  EmptyState,
  DataTable,
} from '@/components/ui';
import { formatCost, formatDuration, formatTokens } from '@/usage/format';
import type { StandaloneRow } from '@/usage/usage-core';

const columns: ColumnDef<StandaloneRow>[] = [
  {
    id: 'activity',
    header: 'Activity',
    cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
  },
  {
    accessorKey: 'taskCount',
    header: 'Count',
    size: 80,
    cell: ({ row }) => <span className="tabular-nums">{row.original.taskCount}</span>,
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
    accessorKey: 'avgCostUsd',
    header: 'Avg/question',
    size: 100,
    cell: ({ row }) => <span className="tabular-nums">{formatCost(row.original.avgCostUsd)}</span>,
  },
  {
    accessorKey: 'tokens',
    header: 'Tokens',
    size: 90,
    cell: ({ row }) => <span className="tabular-nums">{formatTokens(row.original.tokens)}</span>,
  },
  {
    accessorKey: 'durationMs',
    header: 'Agent time',
    size: 100,
    cell: ({ row }) => <span className="tabular-nums">{formatDuration(row.original.durationMs)}</span>,
  },
];

export function StandaloneUsageTable({ data }: { data: StandaloneRow[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((r) => r.label.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div className="forge-spotlight flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))]">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Standalone activity</Title>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input
              aria-label="Search activity"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activity…"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        fill
        getRowId={(r) => r.route}
        emptyState={
          <EmptyState icon={<Zap />} title="No standalone activity" description="No ad-hoc tasks in this period." />
        }
      />
    </div>
  );
}
