import { Suspense } from 'react';
import { FolderKanban } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
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
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <ProjectUsageTable data={rows} detailByProject={detailByProject} />
          </div>
          <div className="flex min-h-0 flex-col gap-4">
            <SettingsAccessNote body={NOTE} icon={<FolderKanban />} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
