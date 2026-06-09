import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';
import { StageStepper } from '@/components/forge/StageStepper';
import {
  getProject,
  getProjectStages,
  assertProjectReadable,
  ProjectAccessError,
} from '@/projects/projects-core';
import { DATA_PHASE } from '@/projects/stage-route';

/**
 * Project shell (Spec 3 flow 3). Guarded: `assertProjectReadable` throws for a
 * hidden private project → `notFound()` (404, anti-enumeration — never 403 on
 * the read path). Sets `data-phase` from `project.phase` (CSS swaps tokens; JS
 * never branches on phase). Renders the real ProjectTopbar + stage-driven
 * StageStepper across all stage routes.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const project = await getProject(id);
  if (!project) notFound();
  const stages = await getProjectStages(id);

  return (
    <div data-phase={DATA_PHASE[project.phase]} className="flex min-h-full flex-col">
      <header className="mb-5 flex flex-col gap-3 border-b border-line pb-4">
        <ProjectTopbar projectName={project.name} phase={project.phase} />
        <StageStepper
          projectId={project.id}
          stages={stages}
          currentStage={project.currentStage}
          phase={project.phase}
        />
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
