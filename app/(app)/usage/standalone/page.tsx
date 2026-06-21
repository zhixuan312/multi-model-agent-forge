import { Suspense } from 'react';
import { Zap } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
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
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <StandaloneUsageTable data={rows} />
          </div>
          <div className="flex min-h-0 flex-col gap-4">
            <SettingsAccessNote body={NOTE} icon={<Zap />} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
