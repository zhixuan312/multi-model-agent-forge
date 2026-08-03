'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useExpandedRow } from '@/hooks/useExpandedRow';
import { BarChart3, ChevronRight } from 'lucide-react';
import {
  Card,
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  EmptyState,
  DataTable,
  DataTableHeader,
  Toolbar,
  SearchInput,
  toolbarControlWidth,
} from '@/components/ui';
import { formatCost, formatDuration } from '@/usage/format';
import { RouteBreakdown } from './RouteBreakdown';
import type { RouteAggRow } from '@/usage/usage-core';
import { USAGE_SOURCES, SOURCE_FILTER_LABEL, type UsageSource } from '@/usage/source';

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

type SourceFilter = 'all' | UsageSource;

export function UsageBatchTable({
  data,
  detailBySource,
}: {
  data: BatchRowData[];
  detailBySource: Record<string, RouteAggRow[]>;
}) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const { expandedId, toggle } = useExpandedRow();

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
            // `aria-expanded` carries the state and the label names WHAT expands. This
            // was a permanent "Expand" with no state at all, so a screen reader heard the
            // same thing whether the row was open or shut — and `isOpen`, computed right
            // above, only ever rotated the chevron.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggle(id)}
              aria-expanded={isOpen}
              aria-label={`Route breakdown for ${row.original.routeLabel}`}
            >
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
      <DataTableHeader title="Activity breakdown">
        <Toolbar>
          <SearchInput label="activity" value={search} onChange={setSearch} />
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
            <SelectTrigger aria-label="Filter by source" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {USAGE_SOURCES.map((src) => (
                <SelectItem key={src} value={src}>
                  {SOURCE_FILTER_LABEL[src]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>
      </DataTableHeader>
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(r) => `${r.source}-${r.route}`}
        expandedId={expandedId}
        renderExpanded={(row) => <RouteBreakdown routes={detailBySource[row.source] ?? []} />}
        emptyState={
          /*
           * A filter miss is the ONLY way this table empties. `data` is the three
           * per-source aggregate rows (`bySources` in usage/page.tsx), which are always
           * present — a period with no activity renders three zero rows, not an empty
           * table. So the three sibling usage tables' empty-vs-filtered split does not
           * apply here; what applies is that the title must not claim "No usage data"
           * when the data is there and the filter hid it.
           */
          <EmptyState
            icon={<BarChart3 />}
            title="No activity matches"
            description="Adjust the search or source filter above."
          />
        }
      />
    </Card>
  );
}
