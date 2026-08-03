import { Suspense } from 'react';
import { Repeat } from 'lucide-react';
import { requireTeamPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { usageByLoop, routeAggForLoop, type RouteAggRow } from '@/usage/usage-core';
import { parsePeriod } from '@/usage/period';
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
  // `requireTeamPage`, not `requireAdminPage`: this page is TEAM-scoped, not admin-only.
  // The admin gate bounced a plain member to `/` while `UsageTabsNav` offered them the
  // tab. `requireTeamPage` keeps the same team scoping and still sends the org admin to
  // /usage, which renders the org-wide numbers-only dashboard for their role.
  const member = await requireTeamPage();
  const deps = { teamId: member.teamId };
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
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
