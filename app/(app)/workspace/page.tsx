import { GitBranch, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageFrame, MetricCard } from '@/components/ui';
import { currentMember } from '@/auth/current-member';
import { listRepos } from '@/git/repos-core';
import { WorkspaceClient, type RepoCardData } from './WorkspaceClient';

/**
 * Workspace page (Spec 2 §Workspace) — the team's shared repo pool, on the
 * Team-Settings shell: a STATUS row (total · cloned · pulling · errors) then a
 * 2/3 ∣ 1/3 row — the filterable repo TABLE (Primary) and the workspace note +
 * admin clone form (Rail). Repos are a homogeneous list, so they get one table
 * (decision 0003), matching Members/Providers.
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

  return (
    <PageFrame title="Workspace" width="full" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Repositories" value={total} sublabel="On disk" icon={<GitBranch />} iconTint="accent" />
          <MetricCard label="Cloned" value={cloned} muted={cloned === 0} sublabel="Ready to use" icon={<CheckCircle2 />} iconTint="sage" />
          <MetricCard label="Pulling" value={pulling} muted={pulling === 0} sublabel="In progress" icon={<RefreshCw />} iconTint="amber" />
          <MetricCard label="Errors" value={errored} muted={errored === 0} sublabel="Need attention" icon={<AlertTriangle />} iconTint="rose" />
        </div>

        <div className="min-h-0 flex-1">
          <WorkspaceClient initialRepos={initialRepos} isAdmin={isAdmin} />
        </div>
      </div>
    </PageFrame>
  );
}
