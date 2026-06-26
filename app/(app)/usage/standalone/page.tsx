import { Suspense } from 'react';
import { Zap } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { usageStandalone, type Period } from '@/usage/usage-core';
import { UsageTabsNav } from '../UsageTabsNav';
import { PeriodSelect } from '../PeriodSelect';
import { StandaloneUsageTable } from '../StandaloneUsageTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOTE = `### Standalone activity

- **Journal recall** — each time you ask a question about prior learnings
- **Ad-hoc task** — one-off delegated work outside a project
- **Research** — external research queries
- **Code investigation** — codebase questions

### How much does a question cost?

The avg/question column shows the typical cost per interaction — usually cents, not dollars`;

export default async function UsageStandalonePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const rows = await usageStandalone(period);

  return (
    <PageFrame
      title="Usage"
      subnav={<UsageTabsNav active="standalone" period={period} />}
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
        primary={<StandaloneUsageTable data={rows} />}
        aside={<RailNote icon={<Zap />}>{NOTE}</RailNote>}
      />
    </PageFrame>
  );
}
