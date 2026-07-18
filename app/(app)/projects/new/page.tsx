import { redirect } from 'next/navigation';
import { FolderPlus } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { listRepos } from '@/git/repos-core';
import { NewProjectForm } from './NewProjectForm';
import type { RepoPickerRepo } from '@/components/forge/RepoPicker';

const NOTE = `### Project

- **Name** — a short label for the work; you can change it later
- **Visibility** — public shows artifacts to the whole team; private hides specs, plans, and drafts (never code)
- **Repositories** — the repos this project touches; agents read and build against them

### Design run

- **Full SDLC** runs every stage, from idea to merged code
- A **subset** runs a contiguous slice of the design chain — Exploration → Spec → Plan — then skips Build and ends at Reflect
- Starting past Exploration needs the upstream file — a **Spec** run wants your exploration, a **Plan** run wants your spec

### What happens next

- Forge opens the run's first stage — you describe the idea, or we ingest your uploaded file as the real artifact, and agents take it forward`;

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
      <StatusDashboard
        primary={<NewProjectForm repos={pickerRepos} />}
        aside={<RailNote icon={<FolderPlus />}>{NOTE}</RailNote>}
      />
    </PageFrame>
  );
}
