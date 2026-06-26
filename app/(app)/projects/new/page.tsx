import { redirect } from 'next/navigation';
import { FolderPlus } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { listRepos } from '@/git/repos-core';
import { NewProjectForm } from './NewProjectForm';
import type { RepoPickerRepo } from '@/components/forge/RepoPicker';

const NOTE = `### Creating a project

- **Name** — a short label for the work; you can change it later
- **Visibility** — public projects are visible to the whole team; private hides work artifacts (specs, plans, drafts) but not code
- **Repositories** — pick the repos this project touches; agents read and build against them

### What happens next

- Forge opens the **Exploration** stage where you describe the idea, attach context, and let agents research before writing a spec`;

export default async function NewProjectPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const repos = await listRepos();
  const pickerRepos: RepoPickerRepo[] = repos.map((r) => ({
    id: r.id,
    name: r.name,
    tags: r.tags,
    status: r.status,
  }));

  return (
    <PageFrame
      title="New project"
      breadcrumb={[{ label: 'Projects', href: '/projects' }, { label: 'New project' }]}
      width="full"
      fill
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <div className="flex min-h-0 flex-col lg:col-span-2">
          <NewProjectForm repos={pickerRepos} />
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <RailNote icon={<FolderPlus />}>{NOTE}</RailNote>
        </div>
      </div>
    </PageFrame>
  );
}
