import { Suspense } from 'react';
import { FolderKanban } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { usageByProject, routeAggForProject, type Period, type RouteAggRow } from '@/usage/usage-core';
import { UsageTabsNav } from '../UsageTabsNav';
import { PeriodSelect } from '../PeriodSelect';
import { ProjectUsageTable } from '../ProjectUsageTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOTE = `### Project costs

- **Cost** — actual spend for all agent work on this project
- **Saved** — estimated savings vs running on your main model
- **Agent Hours** — cumulative time agents spent working

### Expand a row

Click the arrow to see individual tasks: investigations, audits, plan executions, reviews, and learning captures that made up this project's cost`;

export default async function UsageProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const rows = await usageByProject(period);

  const detailByProject: Record<string, RouteAggRow[]> = {};
  await Promise.all(
    rows.map(async (r) => {
      detailByProject[r.projectId] = await routeAggForProject(r.projectId, period);
    }),
  );

  return (
    <PageFrame
      title="Usage"
      subnav={<UsageTabsNav active="projects" period={period} />}
      width="full"
      fill
      actions={
        <Suspense>
          <PeriodSelect />
        </Suspense>
      }
    >
      <StatusDashboard
        metrics={[]}
        primary={<ProjectUsageTable data={rows} detailByProject={detailByProject} />}
        aside={<RailNote icon={<FolderKanban />}>{NOTE}</RailNote>}
      />
    </PageFrame>
  );
}
