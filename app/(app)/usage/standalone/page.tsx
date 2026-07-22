import { Suspense } from 'react';
import { Zap } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
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
  const member = await requireAdminPage();
  // Team-scoped: an unscoped query leaks every team's standalone activity. Org admin → /usage.
  if (member.role === 'org_admin' || !member.teamId) redirect('/usage');
  const sp = await searchParams;
  const period = (['week', 'month', '30d', '90d', 'all'].includes(sp.period ?? '') ? sp.period : 'month') as Period;
  const rows = await usageStandalone(period, { teamId: member.teamId });

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
      <StageShell
        metrics={[]}
        note={<RailNote icon={<Zap />}>{NOTE}</RailNote>}
      >
<StandaloneUsageTable data={rows} />
      </StageShell>
    </PageFrame>
  );
}
