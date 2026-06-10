import { PageHeader } from '@/components/ui';
import { currentMember } from '@/auth/current-member';
import { listRepos } from '@/git/repos-core';
import { WorkspaceClient, type RepoCardData } from './WorkspaceClient';

/**
 * Workspace page (Spec 2 §Workspace). RSC loads the repo list + the viewer's
 * admin flag, then hands them to the client filter island. Non-admins see the
 * list read-only; admins get the add/clone + per-repo pull/remove controls.
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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Workspace" description="The team's shared repositories on disk." />
      <WorkspaceClient initialRepos={initialRepos} isAdmin={isAdmin} />
    </div>
  );
}
