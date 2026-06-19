'use client';

import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, BarChart3, ChevronRight } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Title,
  EmptyState,
  DataTable,
} from '@/components/ui';
import { formatCost, formatDuration } from '@/usage/format';
import { RouteBreakdown } from './RouteBreakdown';
import type { RouteAggRow } from '@/usage/usage-core';

export interface BatchRowData {
  source: string;
  route: string;
  routeLabel: string;
  costUsd: number;
  savedUsd: number;
  avgCostUsd: number;
  durationMs: number;
  taskCount: number;
}

type SourceFilter = 'all' | 'projects' | 'loops' | 'standalone';

export function UsageBatchTable({
  data,
  detailBySource,
}: {
  data: BatchRowData[];
  detailBySource: Record<string, RouteAggRow[]>;
}) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  const columns = useMemo<ColumnDef<BatchRowData>[]>(
    () => [
      {
        id: 'activity',
        header: 'Activity',
        cell: ({ row }) => <span className="font-medium">{row.original.routeLabel}</span>,
      },
      {
        accessorKey: 'taskCount',
        header: 'Tasks',
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
        header: 'Avg/task',
        size: 100,
        cell: ({ row }) => <span className="tabular-nums">{formatCost(row.original.avgCostUsd)}</span>,
      },
      {
        accessorKey: 'durationMs',
        header: 'Agent time',
        size: 100,
        cell: ({ row }) => <span className="tabular-nums">{formatDuration(row.original.durationMs)}</span>,
      },
      {
        id: 'expand',
        header: '',
        size: 48,
        cell: ({ row }) => {
          const id = `${row.original.source}-${row.original.route}`;
          const isOpen = expandedId === id;
          return (
            <Button size="sm" variant="ghost" onClick={() => toggle(id)} aria-label="Expand">
              <ChevronRight className={`size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </Button>
          );
        },
      },
    ],
    [expandedId, toggle],
  );

  const filtered = useMemo(() => {
    let rows = data;
    if (sourceFilter !== 'all') rows = rows.filter((r) => r.source === sourceFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.routeLabel.toLowerCase().includes(q));
    }
    return rows;
  }, [data, search, sourceFilter]);

  return (
    <div className="forge-spotlight flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))]">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Activity breakdown</Title>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input aria-label="Search activity" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity…" className="pl-9" />
          </div>
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
            <SelectTrigger aria-label="Filter by source" className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="projects">Projects</SelectItem>
              <SelectItem value="loops">Loops</SelectItem>
              <SelectItem value="standalone">Standalone</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        fill
        getRowId={(r) => `${r.source}-${r.route}`}
        expandedId={expandedId}
        renderExpanded={(row) => <RouteBreakdown routes={detailBySource[row.source] ?? []} />}
        emptyState={<EmptyState icon={<BarChart3 />} title="No usage data" description="No activity matches your filter in this period." />}
      />
    </div>
  );
}
