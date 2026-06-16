'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, Repeat, Play, Pencil } from 'lucide-react';
import { Button, Badge, Input, Title, TextStrong, Mono, Micro, EmptyState, DataTable, Card, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import type { LoopRow } from '@/db/schema/loop';
import { describeCron } from '@/loops/cron';
import { LoopForm, type RepoOption } from './LoopForm';
import { RUN_STATUS_VARIANT, statusLabel, fmtRunTime } from './run-format';

export interface LastRun {
  status: string;
  at: string | null;
}

/**
 * Loops index (page 1 of 2) — the management table. Mirrors the Team Members
 * table: "New loop" reveals an inline add form at the top; each row's Edit
 * expands an inline reconfigure form. Run now fires the loop. Run history lives
 * on the second tab.
 */
export function LoopsClient({
  initialLoops,
  repoOptions,
  runningLoopIds = [],
  lastRunByLoop = {},
}: {
  initialLoops: LoopRow[];
  repoOptions: RepoOption[];
  runningLoopIds?: string[];
  lastRunByLoop?: Record<string, LastRun>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [trigger, setTrigger] = useState<'all' | 'recurring' | 'oneoff'>('all');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const running = useMemo(() => new Set(runningLoopIds), [runningLoopIds]);

  const openEdit = useCallback((id: string) => { setAdding(false); setEditingId(id); }, []);
  const openAdd = useCallback(() => { setEditingId(null); setAdding(true); }, []);
  const close = useCallback(() => { setEditingId(null); setAdding(false); }, []);

  const runNow = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await fetch(`/api/loops/${id}/run`, { method: 'POST' });
        router.refresh();
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialLoops.filter((l) => {
      if (trigger === 'recurring' && l.cron == null) return false;
      if (trigger === 'oneoff' && l.cron != null) return false;
      if (q && !l.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialLoops, search, trigger]);

  const columns = useMemo<ColumnDef<LoopRow>[]>(
    () => [
      {
        id: 'loop',
        header: 'Loop',
        cell: ({ row }) => {
          const l = row.original;
          return (
            <div className="min-w-0">
              <TextStrong className="block truncate !text-sm !text-ink" title={l.name}>{l.name}</TextStrong>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Badge size="sm" variant={l.workerTier === 'complex' ? 'steel' : 'accent'}>{l.workerTier}</Badge>
              </div>
            </div>
          );
        },
      },
      {
        id: 'schedule',
        header: 'Schedule',
        size: 180,
        cell: ({ row }) => {
          const c = row.original.cron;
          return (
            <div className="min-w-0">
              <span className="block truncate text-sm text-ink">{c ? describeCron(c) : 'One-time'}</span>
              {c ? (
                <Mono className="block truncate !text-[0.6875rem] text-ink-faint" title={c}>{c}</Mono>
              ) : (
                <Micro className="text-ink-faint">Run now only</Micro>
              )}
            </div>
          );
        },
      },
      {
        id: 'repos',
        header: 'Repos',
        size: 80,
        cell: ({ row }) => <Micro className="whitespace-nowrap">{row.original.repoIds.length} repo{row.original.repoIds.length === 1 ? '' : 's'}</Micro>,
      },
      {
        id: 'status',
        header: 'Status',
        size: 100,
        cell: ({ row }) =>
          row.original.cron == null ? (
            <Micro className="text-ink-faint">—</Micro> // one-time has no enable/disable
          ) : (
            <Badge size="sm" variant={row.original.enabled ? 'sage' : 'neutral'} dot={row.original.enabled}>
              {row.original.enabled ? 'enabled' : 'paused'}
            </Badge>
          ),
      },
      {
        id: 'lastRun',
        header: 'Last run',
        size: 160,
        cell: ({ row }) => {
          const last = lastRunByLoop[row.original.id];
          if (!last) return <Micro className="text-ink-faint">—</Micro>;
          return (
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className="block whitespace-nowrap text-sm text-ink">{fmtRunTime(last.at)}</span>
              <Badge size="sm" variant={RUN_STATUS_VARIANT[last.status] ?? 'neutral'} dot={last.status === 'running'}>{statusLabel(last.status)}</Badge>
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 170,
        cell: ({ row }) => {
          const l = row.original;
          const isRunning = running.has(l.id);
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Play />}
                loading={busy === l.id}
                disabled={isRunning || busy === l.id}
                aria-label={isRunning ? `${l.name} is running` : `Run ${l.name} now`}
                onClick={() => runNow(l.id)}
              >
                {isRunning ? 'Running…' : 'Run now'}
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Pencil />} aria-label={`Edit ${l.name}`} onClick={() => openEdit(l.id)}>Edit</Button>
            </div>
          );
        },
      },
    ],
    [busy, running, lastRunByLoop, runNow, openEdit],
  );

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <div className="flex items-center justify-between gap-3">
          <Title className="!text-lg">Loops</Title>
          <Button size="sm" leftIcon={<Repeat />} onClick={openAdd}>New loop</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input aria-label="Search loops" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search loops…" className="pl-9" />
          </div>
          <Select value={trigger} onValueChange={(v) => setTrigger(v as 'all' | 'recurring' | 'oneoff')}>
            <SelectTrigger aria-label="Filter by trigger" className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All triggers</SelectItem>
              <SelectItem value="recurring">Recurring</SelectItem>
              <SelectItem value="oneoff">One-time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        fill
        columns={columns}
        data={shown}
        data-testid="loops-list"
        getRowId={(l) => l.id}
        expandedId={editingId}
        leadingRow={adding ? <LoopForm mode="add" repoOptions={repoOptions} onDone={close} /> : null}
        renderExpanded={(l) => <LoopForm key={l.id} mode="edit" loop={l} repoOptions={repoOptions} onDone={close} />}
        emptyState={<EmptyState icon={<Repeat />} title="No loops yet" description="Create a loop to run a goal against your repos on a schedule." />}
      />
    </Card>
  );
}
