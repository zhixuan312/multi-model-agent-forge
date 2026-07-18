'use client';

import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Repeat, ChevronRight } from 'lucide-react';
import {
  Button,
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
  const [kind, setKind] = useState('all');
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

  const allKinds = useMemo(() => [...new Set(data.map((r) => r.kind))].sort(), [data]);

  const filtered = useMemo(() => {
    let rows = data;
    if (kind !== 'all') rows = rows.filter((r) => r.kind === kind);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.loopName.toLowerCase().includes(q));
    }
    return rows;
  }, [data, search, kind]);

  return (
    <div className="forge-spotlight flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))]">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Loop costs</Title>
        <Toolbar>
          <SearchInput label="loops" value={search} onChange={setSearch} />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="Filter by kind" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {allKinds.map((k) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>
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
