import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';
import { StageStepper } from '@/components/forge/StageStepper';
import { ShellHeader, ShellSubNav, ShellBody } from '@/components/ui/shell';
import {
  getProject,
  getProjectStages,
  assertProjectReadable,
  ProjectAccessError,
} from '@/projects/projects-core';
import { DATA_PHASE } from '@/projects/stage-route';
import { USE_MOCK } from '@/mock/config';
import { findMockProject } from '@/mock/domains/projects/dashboard';
import { STAGE_ORDER } from '@/db/enums';

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

  // Mock mode: the seeded projects have non-UUID ids, so the real DB read would
  // throw. Render a minimal shell from the seed (the detail flow is a later pass).
  if (USE_MOCK) {
    const mock = findMockProject(id);
    if (!mock) notFound();
    const stages = STAGE_ORDER.map((kind) => {
      const s = mock.stages.find((x) => x.kind === kind);
      return { kind, status: s?.status ?? 'pending' };
    });
    return (
      <div data-phase={DATA_PHASE[mock.phase]} className="contents">
        <ShellHeader>
          <ProjectTopbar projectId={mock.id} projectName={mock.name} phase={mock.phase} />
        </ShellHeader>
        <ShellSubNav className="!h-auto !py-2">
          <StageStepper projectId={mock.id} stages={stages} currentStage={mock.currentStage} phase={mock.phase} />
        </ShellSubNav>
        <ShellBody width="full" fill>{children}</ShellBody>
      </div>
    );
  }

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
    <div data-phase={DATA_PHASE[project.phase]} className="contents">
      <ShellHeader>
        <ProjectTopbar projectId={project.id} projectName={project.name} phase={project.phase} />
      </ShellHeader>
      <ShellSubNav className="!h-auto !py-2">
        <StageStepper
          projectId={project.id}
          stages={stages}
          currentStage={project.currentStage}
          phase={project.phase}
        />
      </ShellSubNav>
      <ShellBody>{children}</ShellBody>
    </div>
  );
}
