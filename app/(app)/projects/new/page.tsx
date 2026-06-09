import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageHeader } from '@/components/forge/PageHeader';
import { listRepos } from '@/git/repos-core';
import { NewProjectForm } from './NewProjectForm';
import type { RepoPickerRepo } from '@/components/forge/RepoPicker';

/**
 * New project (Spec 3 flow 1). RSC loads the workspace repo set for the picker;
 * the client form owns name · visibility · repo-subset selection and submits via
 * the `createProjectAction` server action.
 */
export default async function NewProjectPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const repos = await listRepos();
  const pickerRepos: RepoPickerRepo[] = repos.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    tags: r.tags,
    status: r.status,
  }));

  return (
    <>
      <PageHeader title="New project" subtitle="Name it, choose visibility, pick the repos it touches." />
      <NewProjectForm repos={pickerRepos} />
    </>
  );
}
