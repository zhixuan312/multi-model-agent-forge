'use client';

import { NumCell, CostCell, SavedCell, DurationCell } from './usage-cells';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Zap } from 'lucide-react';
import {
  Card,
  EmptyState,
  DataTable,
  DataTableHeader,
  Toolbar,
  SearchInput,
  toolbarControlWidth,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { formatTokens } from '@/usage/format';
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
    cell: ({ row }) => <NumCell value={row.original.taskCount} />,
  },
  {
    accessorKey: 'costUsd',
    header: 'Cost',
    size: 90,
    cell: ({ row }) => <CostCell value={row.original.costUsd} />,
  },
  {
    accessorKey: 'savedUsd',
    header: 'Saved',
    size: 90,
    cell: ({ row }) => <SavedCell value={row.original.savedUsd} />,
  },
  {
    accessorKey: 'avgCostUsd',
    header: 'Avg/question',
    size: 100,
    cell: ({ row }) => <CostCell value={row.original.avgCostUsd} />,
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
    cell: ({ row }) => <DurationCell value={row.original.durationMs} />,
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
      <DataTableHeader title="Standalone activity">
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
      </DataTableHeader>

      <DataTable
        columns={columns}
        data={filtered}
        fill
        getRowId={(r) => r.route}
        emptyState={
          /* `filtered` is what the table renders, so this fires for BOTH an empty period
             and an over-narrow filter — and the period message is wrong advice for the
             second. */
          data.length === 0 ? (
            <EmptyState icon={<Zap />} title="No standalone activity" description="No ad-hoc tasks in this period." />
          ) : (
            <EmptyState icon={<Zap />} title="No activity matches" description="Adjust the search or filter above." />
          )
        }
      />
    </Card>
  );
}
