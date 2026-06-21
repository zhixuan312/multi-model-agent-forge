import { Suspense } from 'react';
import { Repeat } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
import { usageByLoop, routeAggForLoop, type Period, type RouteAggRow } from '@/usage/usage-core';
import { UsageTabsNav } from '../UsageTabsNav';
import { PeriodSelect } from '../PeriodSelect';
import { LoopUsageTable } from '../LoopUsageTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOTE = `### Is this loop earning its keep?

- **Changed** — runs that found real work and opened a PR
- **No changes** — the loop ran but found nothing to do

### Expand a row

Click the arrow to see individual runs and the MMA tasks each run dispatched: orchestration, recall, delegate work, and journal recording`;

export default async function UsageLoopsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const rows = await usageByLoop(period);

  const detailByLoop: Record<string, RouteAggRow[]> = {};
  await Promise.all(
    rows.map(async (r) => {
      detailByLoop[r.loopId] = await routeAggForLoop(r.loopId, period);
    }),
  );

  return (
    <PageFrame
      title="Usage"
      subnav={<UsageTabsNav active="loops" period={period} />}
      width="full"
      fill
      actions={
        <Suspense>
          <PeriodSelect />
        </Suspense>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <LoopUsageTable data={rows} detailByLoop={detailByLoop} />
          </div>
          <div className="flex min-h-0 flex-col gap-4">
            <SettingsAccessNote body={NOTE} icon={<Repeat />} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
