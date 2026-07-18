import { GitBranch, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { requireTeamPage } from '@/auth/require-admin';
import { listRepos, syncWorkspaceRepos } from '@/git/repos-core';
import { WorkspaceClient, type RepoCardData } from './WorkspaceClient';

const WORKSPACE_NOTE = `### Shared repositories

- **The team's git repos** — cloned on disk, the roots projects build against
- **Admins** — clone, pull and remove them
- **Everyone else** — sees the pool read-only

### Status

- **Cloned** — ready to use
- **Pulling** — git is fetching the latest
- **Error** — the last clone or pull failed`;

/**
 * Workspace page (Spec 2 §Workspace) — the team's shared repo pool, on the
 * Team-Settings shell: a STATUS row (total · cloned · pulling · errors) then a
 * 2/3 ∣ 1/3 row — the filterable repo TABLE (Primary) and the workspace note
 * (Rail). Repos are a homogeneous list, so they get one table (decision 0003),
 * matching Members. Data is live: rows come from `forge.repo` and clone/pull run
 * real git via the WorkspaceService.
 */
export default async function WorkspacePage() {
  const me = await requireTeamPage();
  const isAdmin = me.role === 'team_admin';
  await syncWorkspaceRepos();
  const repos = await listRepos();

  const initialRepos: RepoCardData[] = repos.map((r) => ({
    id: r.id,
    name: r.name,
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
      <StageShell
        metrics={[
          { label: 'Repositories', value: total, sublabel: 'On disk', icon: <GitBranch />, iconTint: 'accent' },
          { label: 'Cloned', value: cloned, muted: cloned === 0, sublabel: 'Ready to use', icon: <CheckCircle2 />, iconTint: 'sage' },
          { label: 'Pulling', value: pulling, muted: pulling === 0, sublabel: 'In progress', icon: <RefreshCw />, iconTint: 'amber' },
          { label: 'Errors', value: errored, muted: errored === 0, sublabel: 'Need attention', icon: <AlertTriangle />, iconTint: 'rose' },
        ]}
        note={<RailNote icon={<GitBranch />}>{WORKSPACE_NOTE}</RailNote>}
      >
<WorkspaceClient initialRepos={initialRepos} isAdmin={isAdmin} />
      </StageShell>
    </PageFrame>
  );
}
