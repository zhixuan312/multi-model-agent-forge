import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { FolderKanban } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
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
  const member = await requireAdminPage();
  // Team-scoped detail: an unscoped query returns EVERY team's projects (cross-tenant leak).
  // The org admin owns no team and must not see team project contents — send them to /usage,
  // which renders the org-wide numbers-only dashboard for their role.
  if (member.role === 'org_admin' || !member.teamId) redirect('/usage');
  const deps = { teamId: member.teamId };
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const rows = await usageByProject(period, deps);

  const detailByProject: Record<string, RouteAggRow[]> = {};
  await Promise.all(
    rows.map(async (r) => {
      detailByProject[r.projectId] = await routeAggForProject(r.projectId, period, deps);
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
      <StageShell
        metrics={[]}
        note={<RailNote icon={<FolderKanban />}>{NOTE}</RailNote>}
      >
<ProjectUsageTable data={rows} detailByProject={detailByProject} />
      </StageShell>
    </PageFrame>
  );
}
