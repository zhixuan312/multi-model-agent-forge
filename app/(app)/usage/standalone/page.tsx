import { Suspense } from 'react';
import { Zap } from 'lucide-react';
import { requireTeamPage } from '@/auth/require-admin';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { usageStandalone } from '@/usage/usage-core';
import { parsePeriod } from '@/usage/period';
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
  // `requireTeamPage`, not `requireAdminPage`: this page is TEAM-scoped, not
  // admin-only. The admin gate bounced a plain member to `/` — while `UsageTabsNav`
  // offered them the tab — and the org admin still lands on `/usage`.
  const member = await requireTeamPage();
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const rows = await usageStandalone(period, { teamId: member.teamId });

  return (
    <PageFrame
      title="Usage"
      subnav={<UsageTabsNav active="standalone" period={period} role={member.role} />}
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
