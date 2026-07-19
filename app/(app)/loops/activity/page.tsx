import { History, GitPullRequest, CircleAlert, Loader } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { getDb } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { listLoops } from '@/loops/loops-core';
import { listAllRuns } from '@/loops/runs-query';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import type { LoopRunRow } from '@/db/schema/loop';
import { LoopsTabsNav } from '../LoopsTabsNav';
import { RunHistoryView } from '../RunHistoryView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['running', 'changed', 'no_changes', 'failed']);

const HISTORY_NOTE = `### Reading a run

- **Select** a run to see its full record
- **Summary** — what the worker did
- **Verification** — whether the build/test command passed
- **Journal** — what it learned, missed or avoided

### Statuses

- **Running** — in progress right now
- **Changed** — opened a PR for review
- **No changes** — nothing needed doing
- **Failed** — needs attention`;

/**
 * `/loops/activity` — Run history tab (page 2). Tabs on top, a 4-box status row,
 * then a journal-style master/detail: the selected run's record on the canvas and
 * the filterable run list in the rail. Admin-gated.
 */
export default async function RunHistoryPage({ searchParams }: { searchParams: Promise<{ loop?: string; status?: string; run?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const db = getDb();

  const [loops, repoRows] = await Promise.all([
    listLoops({ db }),
    db.select({ id: repo.id, name: repo.name }).from(repo),
  ]);
  const loopNames = Object.fromEntries(loops.map((l) => [l.id, l.name]));
  const repoNames = Object.fromEntries(repoRows.map((r) => [r.id, r.name]));
  const loopId = sp.loop && loops.some((l) => l.id === sp.loop) ? sp.loop : undefined;
  const status = sp.status && STATUSES.has(sp.status) ? (sp.status as LoopRunRow['status']) : undefined;
  const runs = await listAllRuns({ db, loopId, status, limit: 200 });
  const selectedId = sp.run && runs.some((r) => r.id === sp.run) ? sp.run : runs[0]?.id ?? null;

  const changed = runs.filter((r) => r.status === 'changed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const running = runs.filter((r) => r.status === 'running').length;

  return (
    <PageFrame title="Loops" subnav={<LoopsTabsNav active="history" />} width="full" fill>
      {/* ONE content shell per page: RunHistoryView renders its own, so wrapping it in a
          second here split the layout twice and left an empty right third. The metrics row
          is passed through to that shell instead. */}
      <RunHistoryView
        metrics={[
          { label: 'Runs', value: runs.length, muted: runs.length === 0, sublabel: 'In view', icon: <History />, iconTint: 'accent' },
          { label: 'Changed', value: changed, muted: changed === 0, sublabel: 'Opened a PR', icon: <GitPullRequest />, iconTint: 'sage' },
          { label: 'Failed', value: failed, muted: failed === 0, sublabel: 'Need attention', icon: <CircleAlert />, iconTint: 'rose' },
          { label: 'Running', value: running, muted: running === 0, sublabel: 'In progress', icon: <Loader />, iconTint: 'steel' },
        ]}
        runs={runs}
        loops={loops.map((l) => ({ id: l.id, name: l.name }))}
        loopNames={loopNames}
        repoNames={repoNames}
        selectedId={selectedId}
        loopId={loopId}
        status={status}
        note={<RailNote icon={<History />}>{HISTORY_NOTE}</RailNote>}
      />
    </PageFrame>
  );
}
