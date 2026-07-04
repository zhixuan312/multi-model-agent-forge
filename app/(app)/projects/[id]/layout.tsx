import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';
import { LiveStageStepper } from '@/components/forge/LiveStageStepper';
import { AutomationGate } from '@/components/forge/AutomationGate';
import { ShellHeader, ShellSubNav, ShellBody } from '@/components/ui/shell';
import {
  getProject,
  getProjectStages,
  assertProjectReadable,
  ProjectAccessError,
} from '@/projects/projects-core';
import { getStagePermissions } from '@/projects/stage-gate';
import { ensureStageReached } from '@/projects/stage-lifecycle';
import { getDb } from '@/db/client';
import { PhaseFromRoute } from '@/components/forge/PhaseFromRoute';
import type { StageKind } from '@/db/enums';

const SEGMENT_TO_STAGE: Record<string, StageKind> = {
  explore: 'exploration',
  spec: 'spec',
  plan: 'plan',
  execute: 'execute',
  review: 'review',
  journal: 'journal',
};

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

  const db = getDb();

  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const segments = pathname.split('/');
  const idIdx = segments.indexOf(id);
  const stageSegment = idIdx >= 0 ? segments[idIdx + 1] ?? '' : '';
  const viewingStage = SEGMENT_TO_STAGE[stageSegment];

  if (viewingStage) {
    await ensureStageReached(db, id, viewingStage);
  }

  const project = await getProject(id);
  if (!project) notFound();
  const [stages, perms] = await Promise.all([
    getProjectStages(id),
    getStagePermissions(db, id),
  ]);

  const PERM_KEY: Record<string, keyof typeof perms> = {
    exploration: 'explore', spec: 'spec', plan: 'plan',
    execute: 'execute', review: 'review', journal: 'journal',
  };
  const lockedStages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const)
    .filter((k) => !perms[PERM_KEY[k]].canMutate);

  // Derive the current stage from details (the active stage) rather than trusting
  // the denormalized column — automation advances stages without a page visit, so
  // the column can lag; the stepper must never show a stale/misleading stage.
  const activeStage = stages.find((s) => s.status === 'active')?.kind ?? project.currentStage;
  const activePhase = stages.find((s) => s.kind === activeStage)?.lastPhase ?? undefined;

  return (
    <PhaseFromRoute>
      <ShellHeader>
        <ProjectTopbar
          projectId={project.id}
          projectName={project.name}
          phase={project.phase}
          eventCount={(() => {
            try { return ((project.details as any)?.events?.length as number) ?? 0; } catch { return 0; }
          })()}
        />
      </ShellHeader>
      <ShellSubNav className="!h-auto !py-3 !px-8 md:!px-12 lg:!px-16">
        <LiveStageStepper
          projectId={project.id}
          stages={stages}
          currentStage={activeStage}
          phase={project.phase}
          lockedStages={lockedStages}
          autoMode={project.autoMode}
          activePhase={activePhase}
        />
      </ShellSubNav>
      <ShellBody width="full" fill>
        <AutomationGate
          projectId={project.id}
          projectName={project.name}
          autoMode={project.autoMode}
          autoNote={project.autoNote ?? ''}
          currentStage={activeStage ?? 'spec'}
          phase={project.phase}
          stagePhase={stages.find(s => s.kind === activeStage)?.lastPhase ?? undefined}
          automationStartedAt={(() => {
            if (!project.details) return undefined;
            try {
              const d = (project.details as any);
              return d?.automation?.startedAt ?? undefined;
            } catch { return undefined; }
          })()}
          auditPassCount={(() => {
            if (!project.details) return undefined;
            try {
              const d = (project.details as any);
              const stage = project.currentStage;
              if (stage === 'spec') return d?.stages?.spec?.phases?.finalize?.auditPasses?.length ?? 0;
              if (stage === 'plan') return d?.stages?.plan?.phases?.validate?.auditPasses?.length ?? 0;
              return undefined;
            } catch { return undefined; }
          })()}
          events={(() => {
            if (!project.details) return undefined;
            try { return (project.details as any)?.events ?? []; } catch { return []; }
          })()}
        >
          {children}
        </AutomationGate>
      </ShellBody>
    </PhaseFromRoute>
  );
}
