import { GitBranch, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageFrame, MetricRow, MetricCard } from '@/components/ui';
import { currentMember } from '@/auth/current-member';
import { listRepos } from '@/git/repos-core';
import { WorkspaceClient, type RepoCardData } from './WorkspaceClient';

/**
 * Workspace page (Spec 2 §Workspace) — the shared repo pool. STATUS: repo health
 * (total · cloned · pulling · errors, real `repo.status` counts; no fabricated
 * "stale" since there's no last-synced timestamp). CONTROLS + PRIMARY live in the
 * client filter island. Status collapses on an empty workspace — the island's
 * own EmptyState carries the page.
 */
export default async function WorkspacePage() {
  const me = await currentMember();
  const isAdmin = me?.isAdmin ?? false;
  const repos = await listRepos();
  const initialRepos: RepoCardData[] = repos.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    tags: r.tags,
    defaultBranch: r.defaultBranch,
    status: r.status,
    headSha: r.headSha,
  }));

  const total = repos.length;
  const cloned = repos.filter((r) => r.status === 'cloned').length;
  const pulling = repos.filter((r) => r.status === 'pulling').length;
  const errored = repos.filter((r) => r.status === 'error').length;

  const island = <WorkspaceClient initialRepos={initialRepos} isAdmin={isAdmin} />;

  return (
    <PageFrame title="Workspace" description="The team's shared repositories on disk.">
      {total > 0 ? (
        <div className="flex flex-col gap-6">
          <MetricRow>
            <MetricCard label="Repositories" value={total} icon={<GitBranch />} />
            <MetricCard label="Cloned" value={cloned} muted={cloned === 0} icon={<CheckCircle2 />} />
            <MetricCard label="Pulling" value={pulling} muted={pulling === 0} icon={<RefreshCw />} />
            <MetricCard
              label="Errors"
              value={errored}
              tone={errored > 0 ? 'attention' : 'neutral'}
              muted={errored === 0}
              icon={<AlertTriangle />}
            />
          </MetricRow>
          {island}
        </div>
      ) : (
        island
      )}
    </PageFrame>
  );
}
