'use client';

import { NumCell, CostCell, SavedCell, DurationCell } from './usage-cells';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useExpandedRow } from '@/hooks/useExpandedRow';
import { FolderKanban, ChevronRight } from 'lucide-react';
import {
  Card,
  Badge,
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
import { RouteBreakdown } from './RouteBreakdown';
import type { ProjectUsageRow, RouteAggRow } from '@/usage/usage-core';
import { PROJECT_PHASE, type ProjectPhase } from '@/db/enums';

/**
 * `PROJECT_PHASE` has FOUR members; this union listed three, omitting `completed`.
 *
 * `usageByProject` applies no phase filter, so completed projects DO appear in the table —
 * their row renders a `completed` badge. But the dropdown offered design · build · learn,
 * so selecting any phase hid them and there was no option that showed them. A phase you
 * can see in a column and cannot filter by.
 *
 * Third time `completed` has been the forgotten member (the Active metric on the projects
 * dashboard was the first). Derived now, with a total label map so a fifth phase fails the
 * build rather than quietly going unfilterable.
 */
type PhaseFilter = 'all' | ProjectPhase;

const PHASE_LABEL: Record<ProjectPhase, string> = {
  design: 'Design',
  build: 'Build',
  learn: 'Learn',
  completed: 'Completed',
};

export function ProjectUsageTable({
  data,
  detailByProject,
}: {
  data: ProjectUsageRow[];
  detailByProject: Record<string, RouteAggRow[]>;
}) {
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const { expandedId, toggle } = useExpandedRow();

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
        cell: ({ row }) => <NumCell value={row.original.taskCount} />,
      },
      {
        accessorKey: 'costUsd',
        header: 'Cost',
        size: 100,
        cell: ({ row }) => <CostCell value={row.original.costUsd} />,
      },
      {
        accessorKey: 'savedUsd',
        header: 'Saved',
        size: 100,
        cell: ({ row }) => <SavedCell value={row.original.savedUsd} />,
      },
      {
        accessorKey: 'durationMs',
        header: 'Agent hours',
        size: 100,
        cell: ({ row }) => <DurationCell value={row.original.durationMs} />,
      },
      {
        id: 'expand',
        header: '',
        size: 48,
        cell: ({ row }) => {
          const isOpen = expandedId === row.original.projectId;
          return (
            // `aria-expanded` carries the state and the label names WHAT expands. This
            // was a permanent "Expand" with no state at all, so a screen reader heard the
            // same thing whether the row was open or shut — and `isOpen`, computed right
            // above, only ever rotated the chevron.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggle(row.original.projectId)}
              aria-expanded={isOpen}
              aria-label={`Route breakdown for ${row.original.projectName}`}
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
    if (phase !== 'all') rows = rows.filter((r) => r.phase === phase);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.projectName.toLowerCase().includes(q));
    }
    return rows;
  }, [data, search, phase]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <DataTableHeader title="Project costs">
        <Toolbar>
          <SearchInput label="projects" value={search} onChange={setSearch} />
          <Select value={phase} onValueChange={(v) => setPhase(v as PhaseFilter)}>
            <SelectTrigger aria-label="Filter by phase" className={toolbarControlWidth}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All phases</SelectItem>
              {PROJECT_PHASE.map((ph) => (
                <SelectItem key={ph} value={ph}>{PHASE_LABEL[ph]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>
      </DataTableHeader>
      <DataTable
        columns={columns}
        data={filtered}
        fill
        getRowId={(r) => r.projectId}
        expandedId={expandedId}
        renderExpanded={(row) => <RouteBreakdown routes={detailByProject[row.projectId] ?? []} />}
        emptyState={
          /* `filtered` is what the table renders, so this fires for BOTH an empty period
             and an over-narrow filter — the period message is wrong advice for the second. */
          data.length === 0 ? (
            <EmptyState icon={<FolderKanban />} title="No project activity" description="No projects have usage data in this period." />
          ) : (
            <EmptyState icon={<FolderKanban />} title="No projects match" description="Adjust the search or filter above." />
          )
        }
      />
    </Card>
  );
}
