import { Suspense } from 'react';
import { DollarSign, TrendingUp, Clock, Cpu } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame, MetricCard } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
import { usageOverview, routeAggForSource, type Period, type RouteAggRow } from '@/usage/usage-core';
import { formatCost, formatTokens, formatDuration, formatRoi } from '@/usage/format';
import { UsageTabsNav } from './UsageTabsNav';
import { PeriodSelect } from './PeriodSelect';
import { UsageBatchTable, type BatchRowData } from './UsageBatchTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOTE = `### Understanding usage

- **Spent** — actual cost of all agent work in this period
- **Saved** — estimated cost if these tasks ran on your main model instead of dedicated workers
- **Agent Hours** — time agents spent working (tasks may run in parallel, so this can exceed real-time)

### What counts as a source

- **Projects** — your SDLC pipeline: research, spec refinement, audits, building, code review, and learning capture
- **Loops** — scheduled maintenance jobs that run on their own
- **Standalone** — ad-hoc questions (journal recall), one-off research, and direct delegations`;

export default async function UsageOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const data = await usageOverview(period);

  // Pre-load per-source route aggregation for expandable rows
  const [projectRoutes, loopRoutes, standaloneRoutes] = await Promise.all([
    routeAggForSource('projects', period),
    routeAggForSource('loops', period),
    routeAggForSource('standalone', period),
  ]);
  const detailBySource: Record<string, RouteAggRow[]> = {
    projects: projectRoutes,
    loops: loopRoutes,
    standalone: standaloneRoutes,
  };

  const tableRows: BatchRowData[] = data.bySources.map((s) => ({
    source: s.source,
    route: s.source,
    routeLabel: s.source === 'projects' ? 'Projects (SDLC)' : s.source === 'loops' ? 'Loops (scheduled)' : 'Standalone (ad-hoc)',
    costUsd: s.costUsd,
    savedUsd: s.savedUsd,
    avgCostUsd: s.taskCount > 0 ? s.costUsd / s.taskCount : 0,
    durationMs: s.durationMs,
    taskCount: s.taskCount,
  }));

  return (
    <PageFrame
      title="Usage"
      subnav={<UsageTabsNav active="overview" period={period} />}
      width="full"
      fill
      actions={
        <Suspense>
          <PeriodSelect />
        </Suspense>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="Spent"
            value={formatCost(data.metrics.totalCost)}
            sublabel={`${data.metrics.taskCount} tasks`}
            icon={<DollarSign />}
            iconTint="accent"
            muted={data.metrics.taskCount === 0}
          />
          <MetricCard
            label="Saved"
            value={formatCost(data.metrics.totalSaved || null)}
            sublabel={formatRoi(data.metrics.totalSaved, data.metrics.totalCost)}
            icon={<TrendingUp />}
            iconTint="sage"
            muted={!data.metrics.totalSaved}
          />
          <MetricCard
            label="Agent Hours"
            value={formatDuration(data.metrics.totalDurationMs)}
            sublabel="work done while you focused elsewhere"
            icon={<Clock />}
            iconTint="rose"
            muted={data.metrics.totalDurationMs === 0}
          />
          <MetricCard
            label="Tokens"
            value={formatTokens(data.metrics.totalTokens)}
            sublabel="input + output"
            icon={<Cpu />}
            iconTint="steel"
            muted={data.metrics.totalTokens === 0}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <UsageBatchTable data={tableRows} detailBySource={detailBySource} />
          </div>
          <div className="flex min-h-0 flex-col gap-4">
            <SettingsAccessNote body={NOTE} icon={<DollarSign />} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
