'use client';

import { type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { History } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Badge, Mono, Micro, EmptyState } from '@/components/ui';
import { StageShell } from '@/components/patterns/stage-shell';
import type { StatusDashboardProps } from '@/components/patterns/status-dashboard';
import type { LoopRunRow } from '@/db/schema/loop';
import { ActivityFilters } from './ActivityFilters';
import { RunDetail } from './RunDetail';
import { RUN_STATUS_VARIANT, statusLabel, fmtRunTime, fmtDuration, shortId } from './run-format';

/**
 * Run history (page 2) — journal-style master/detail. The 2/3 canvas shows the
 * selected run's full record (defaulting to the newest so it's never empty); the
 * 1/3 rail carries the loop/status filters and the scrollable run list.
 * Selection is URL-driven (`?run=`); no inline table expansion.
 */
export function RunHistoryView({
  runs,
  loops,
  loopNames,
  repoNames,
  selectedId,
  loopId,
  status,
  note,
  metrics,
}: {
  runs: LoopRunRow[];
  loops: { id: string; name: string }[];
  loopNames: Record<string, string>;
  repoNames: Record<string, string>;
  selectedId: string | null;
  loopId?: string;
  status?: string;
  note?: ReactNode;
  /** Metric row for this view's own shell — the page must not wrap this in a second one. */
  metrics?: StatusDashboardProps['metrics'];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = runs.find((r) => r.id === selectedId) ?? null;

  function select(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('run', id);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <StageShell
      scroll="outer"
      metrics={metrics}
      note={note}
      navigator={
        <>
        <ActivityFilters loops={loops} loopId={loopId} status={status} />
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <span className="shrink-0 px-1 text-xs font-medium uppercase tracking-wide text-ink-faint">Runs ({runs.length})</span>
            {runs.length ? (
              <ul className="flex flex-col gap-1.5" data-testid="run-list">
                {runs.map((r) => {
                  const active = r.id === selectedId;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => select(r.id)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'focus-ring flex w-full flex-col gap-1 rounded-[var(--r-md)] border p-2.5 text-left transition-colors',
                          active ? 'border-accent/50 bg-accent-tint/25' : 'border-line hover:bg-bg-sunk',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge size="sm" variant={RUN_STATUS_VARIANT[r.status] ?? 'neutral'} dot={r.status === 'running'}>{statusLabel(r.status)}</Badge>
                          <Mono className="!text-[0.6875rem] text-ink-faint">{shortId(r.runId)}</Mono>
                        </div>
                        <span className="truncate text-sm text-ink">{loopNames[r.loopId] ?? shortId(r.loopId)}</span>
                        <Micro className="text-ink-faint">{fmtRunTime(r.startedAt)} · {fmtDuration(r.startedAt, r.finishedAt)}</Micro>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Micro className="px-1 text-ink-faint">No runs match these filters.</Micro>
            )}
          </CardContent>
        </Card>
        </>
      }
    >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-5">
            {selected ? (
              <RunDetail run={selected} repoName={repoNames[selected.repoId]} />
            ) : (
              <EmptyState icon={<History />} title="No runs yet" description="Runs appear here once a loop fires — manually or on schedule." />
            )}
          </CardContent>
        </Card>
    </StageShell>
  );
}
