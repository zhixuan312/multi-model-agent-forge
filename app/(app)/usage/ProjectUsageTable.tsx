'use client';

import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, FolderKanban, ChevronRight } from 'lucide-react';
import {
  Badge,
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
import type { ProjectUsageRow, RouteAggRow } from '@/usage/usage-core';

type PhaseFilter = 'all' | 'design' | 'build' | 'learn';

export function ProjectUsageTable({
  data,
  detailByProject,
}: {
  data: ProjectUsageRow[];
  detailByProject: Record<string, RouteAggRow[]>;
}) {
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  const columns = useMemo<ColumnDef<ProjectUsageRow>[]>(
    () => [
      {
        id: 'project',
        header: 'Project',
        cell: ({ row }) => <span className="font-medium">{row.original.projectName}</span>,
      },
      {
        id: 'phase',
        header: 'Phase',
        size: 100,
        cell: ({ row }) => <Badge variant="neutral" size="sm">{row.original.phase}</Badge>,
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
        size: 100,
        cell: ({ row }) => <span className="tabular-nums">{formatCost(row.original.costUsd)}</span>,
      },
      {
        accessorKey: 'savedUsd',
        header: 'Saved',
        size: 100,
        cell: ({ row }) => (
          <span className="tabular-nums text-[var(--sage)]">{formatCost(row.original.savedUsd || null)}</span>
        ),
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
          const isOpen = expandedId === row.original.projectId;
          return (
            <Button size="sm" variant="ghost" onClick={() => toggle(row.original.projectId)} aria-label="Expand">
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
    if (phase !== 'all') rows = rows.filter((r) => r.phase === phase);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.projectName.toLowerCase().includes(q));
    }
    return rows;
  }, [data, search, phase]);

  return (
    <div className="forge-spotlight flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))]">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <Title className="!text-lg">Project costs</Title>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" className="pl-9" />
          </div>
          <Select value={phase} onValueChange={(v) => setPhase(v as PhaseFilter)}>
            <SelectTrigger aria-label="Filter by phase" className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All phases</SelectItem>
              <SelectItem value="design">Design</SelectItem>
              <SelectItem value="build">Build</SelectItem>
              <SelectItem value="learn">Learn</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        fill
        getRowId={(r) => r.projectId}
        expandedId={expandedId}
        renderExpanded={(row) => <RouteBreakdown routes={detailByProject[row.projectId] ?? []} />}
        emptyState={<EmptyState icon={<FolderKanban />} title="No project activity" description="No projects have usage data in this period." />}
      />
    </div>
  );
}
