import { Suspense } from 'react';
import { Repeat } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
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
  const member = await requireAdminPage();
  // Team-scoped: an unscoped query leaks every team's loops. Org admin (no team) → /usage.
  if (member.role === 'org_admin' || !member.teamId) redirect('/usage');
  const deps = { teamId: member.teamId };
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const rows = await usageByLoop(period, deps);

  const detailByLoop: Record<string, RouteAggRow[]> = {};
  await Promise.all(
    rows.map(async (r) => {
      detailByLoop[r.loopId] = await routeAggForLoop(r.loopId, period, deps);
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
      <StageShell
        metrics={[]}
        note={<RailNote icon={<Repeat />}>{NOTE}</RailNote>}
      >
<LoopUsageTable data={rows} detailByLoop={detailByLoop} />
      </StageShell>
    </PageFrame>
  );
}
