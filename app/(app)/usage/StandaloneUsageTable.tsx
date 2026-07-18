'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Zap } from 'lucide-react';
import {
  Card,
  Title,
  EmptyState,
  DataTable,
  Toolbar,
  SearchInput,
  toolbarControlWidth,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
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
  const [route, setRoute] = useState('all');

  const allRoutes = useMemo(
    () => [...new Map(data.map((r) => [r.route, r.label])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data;
    if (route !== 'all') rows = rows.filter((r) => r.route === route);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    }
    return rows;
  }, [data, search, route]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Standalone activity</Title>
        <Toolbar>
          <SearchInput label="activity" value={search} onChange={setSearch} />
          <Select value={route} onValueChange={setRoute}>
            <SelectTrigger aria-label="Filter by route" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All routes</SelectItem>
              {allRoutes.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>
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
    </Card>
  );
}
