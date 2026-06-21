import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';
import { LiveStageStepper } from '@/components/forge/LiveStageStepper';
import { ShellHeader, ShellSubNav, ShellBody } from '@/components/ui/shell';
import {
  getProject,
  getProjectStages,
  assertProjectReadable,
  ProjectAccessError,
} from '@/projects/projects-core';
import { DATA_PHASE } from '@/projects/stage-route';
import { PhaseFromRoute } from '@/components/forge/PhaseFromRoute';

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
    <PhaseFromRoute fallback={DATA_PHASE[project.phase]}>
      <ShellHeader>
        <ProjectTopbar projectId={project.id} projectName={project.name} phase={project.phase} />
      </ShellHeader>
      <ShellSubNav className="!h-auto !py-2">
        <LiveStageStepper
          projectId={project.id}
          stages={stages}
          currentStage={project.currentStage}
          phase={project.phase}
        />
      </ShellSubNav>
      <ShellBody width="full" fill>{children}</ShellBody>
    </PhaseFromRoute>
  );
}
