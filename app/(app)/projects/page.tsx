import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageHeader } from '@/components/forge/PageHeader';
import { ProjectFilterBar } from '@/components/forge/ProjectFilterBar';
import { visibleProjects } from '@/projects/projects-core';

/**
 * Projects list (Spec 3 flow 2). RSC loads the viewer's full visible set via the
 * single `visibleProjects(member)` query (stage join + resolvable-repo count, no
 * N+1), then hydrates it into the client `ProjectFilterBar` which filters
 * in-memory.
 */
export default async function ProjectsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const projects = await visibleProjects({ id: me.id });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Idea → spec → freeze → committed code, with MMA doing the work underneath."
        actions={
          <Link
            href="/projects/new"
            className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            ＋ New project
          </Link>
        }
      />
      <ProjectFilterBar projects={projects} />
    </>
  );
}
