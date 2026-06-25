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
import { getStagePermissions } from '@/projects/stage-gate';
import { getDb } from '@/db/client';
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
  const [stages, perms] = await Promise.all([
    getProjectStages(id),
    getStagePermissions(getDb(), id),
  ]);

  const PERM_KEY: Record<string, keyof typeof perms> = {
    exploration: 'explore', spec: 'spec', plan: 'plan',
    execute: 'execute', review: 'review', journal: 'journal',
  };
  const lockedStages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const)
    .filter((k) => !perms[PERM_KEY[k]].canMutate);

  return (
    <PhaseFromRoute>
      <ShellHeader>
        <ProjectTopbar projectId={project.id} projectName={project.name} phase={project.phase} />
      </ShellHeader>
      <ShellSubNav className="!h-auto !py-3 !px-8 md:!px-12 lg:!px-16">
        <LiveStageStepper
          projectId={project.id}
          stages={stages}
          currentStage={project.currentStage}
          phase={project.phase}
          lockedStages={lockedStages}
        />
      </ShellSubNav>
      <ShellBody width="full" fill>{children}</ShellBody>
    </PhaseFromRoute>
  );
}
