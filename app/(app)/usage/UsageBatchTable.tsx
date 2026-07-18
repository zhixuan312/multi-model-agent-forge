'use client';

import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { BarChart3, ChevronRight } from 'lucide-react';
import {
  Card,
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Title,
  EmptyState,
  DataTable,
  Toolbar,
  SearchInput,
  toolbarControlWidth,
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
    <Card className="flex flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Activity breakdown</Title>
        <Toolbar>
          <SearchInput label="activity" value={search} onChange={setSearch} />
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
            <SelectTrigger aria-label="Filter by source" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="projects">Projects</SelectItem>
              <SelectItem value="loops">Loops</SelectItem>
              <SelectItem value="standalone">Standalone</SelectItem>
            </SelectContent>
          </Select>
        </Toolbar>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(r) => `${r.source}-${r.route}`}
        expandedId={expandedId}
        renderExpanded={(row) => <RouteBreakdown routes={detailBySource[row.source] ?? []} />}
        emptyState={<EmptyState icon={<BarChart3 />} title="No usage data" description="No activity matches your filter in this period." />}
      />
    </Card>
  );
}
