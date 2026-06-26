import { eq } from 'drizzle-orm';
import { Repeat, Power, Clock, CircleCheck } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { getDb } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { loopRun } from '@/db/schema/loop';
import { listLoops } from '@/loops/loops-core';
import { latestRunPerLoop } from '@/loops/runs-query';
import { nextRuns, LOOP_TIMEZONE } from '@/loops/cron';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { LoopsTabsNav } from './LoopsTabsNav';
import { LoopsClient } from './LoopsClient';
import { statusLabel } from './run-format';

const LOOPS_NOTE = `### Setting up a loop

- **Repos** — pick one or more from the workspace
- **Goal** — what the loop should keep true
- **Trigger** — Recurring (a cron schedule, Singapore time) or One-time (Run now only)
- **Target branch** — base to fork from and open the PR into; blank uses the repo's current branch
- **Worker** — complex (smart) or standard (cheap)

### What a run does

- **Plan** — the orchestrator designs the recalls and picks the verify command
- **Recall** — reads prior runs' journal for context
- **Work** — an MMA worker pursues the goal in an isolated worktree
- **Verify** — runs the chosen build/test command
- **PR** — pushes a branch and opens a pull request when something changed
- **Journal** — records what it learned, missed or avoided

### Safe by default

- Never auto-merges — you review every PR
- Admin-only`;

export default async function LoopsPage() {
  await requireAdminPage();
  const db = getDb();
  const [loops, repoOptions, latestByLoop, runningRows] = await Promise.all([
    listLoops({ db }),
    db.select({ id: repo.id, name: repo.name }).from(repo).orderBy(repo.name),
    latestRunPerLoop({ db }),
    db.select({ loopId: loopRun.loopId }).from(loopRun).where(eq(loopRun.status, 'running')),
  ]);
  const runningLoopIds = [...new Set(runningRows.map((r) => r.loopId))];
  const lastRunByLoop = Object.fromEntries(
    Object.entries(latestByLoop).map(([id, r]) => [id, { status: r.status, at: (r.finishedAt ?? r.startedAt)?.toISOString() ?? null }]),
  );

  const enabled = loops.filter((l) => l.enabled);
  const nextRun = enabled
    .flatMap((l) => (l.cron ? nextRuns(l.cron, 1) : [])) // one-time jobs have no next run
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const nextRunLabel = nextRun
    ? nextRun.toLocaleString('en-GB', { timeZone: LOOP_TIMEZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
  const lastRun = Object.values(latestByLoop).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  return (
    <PageFrame title="Loops" subnav={<LoopsTabsNav active="loops" />} width="full" fill>
      <StatusDashboard
        metrics={[
          { label: 'Loops', value: loops.length, muted: loops.length === 0, sublabel: 'Configured', icon: <Repeat />, iconTint: 'accent' },
          { label: 'Enabled', value: enabled.length, muted: enabled.length === 0, sublabel: 'On schedule', icon: <Power />, iconTint: 'sage' },
          { label: 'Next run', value: nextRunLabel, muted: !nextRun, sublabel: 'Singapore time', icon: <Clock />, iconTint: 'steel' },
          { label: 'Last run', value: lastRun ? statusLabel(lastRun.status) : '—', muted: !lastRun, sublabel: 'Most recent', icon: <CircleCheck />, iconTint: 'rose' },
        ]}
        primary={<LoopsClient initialLoops={loops} repoOptions={repoOptions} runningLoopIds={runningLoopIds} lastRunByLoop={lastRunByLoop} />}
        aside={<RailNote icon={<Repeat />}>{LOOPS_NOTE}</RailNote>}
      />
    </PageFrame>
  );
}
