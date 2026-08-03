import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
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
import { getDb } from '@/db/client';
import { projectActivity } from '@/db/schema/activity';
import { mapActivityRowToEvent } from '@/activity/project-activity';
import { PhaseFromRoute } from '@/components/forge/PhaseFromRoute';
import { STAGE_KIND, type StageKind } from '@/db/enums';
import { permKeyFor } from '@/projects/stage-freeze';

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
  const actor = projectActorFromMember(me);
  if (!actor) redirect('/');

  try {
    await assertProjectReadable(id, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();

  // Rendering this layout is READ-ONLY — it never advances stages. Stage
  // progression is owned by the auto-driver and the `/advance` route; a page view
  // (including a refresh of a stale URL) must not mutate stage state.
  const project = await getProject(id);
  if (!project) notFound();
  const [stages, perms, activityRows] = await Promise.all([
    getProjectStages(id),
    getStagePermissions(db, id),
    db
      .select()
      .from(projectActivity)
      .where(eq(projectActivity.projectId, id))
      .orderBy(asc(projectActivity.seq)),
  ]);
  const events = activityRows.map(mapActivityRowToEvent);

  // Both halves of this used to be spelled out here: a local kind→permission-key map
  // (`permKeyFor`) and the six stage kinds in order (`STAGE_KIND`).
  const lockedStages = STAGE_KIND.filter((k) => !perms[permKeyFor(k)].canMutate);

  // Derive the current stage from details (the active stage) rather than trusting
  // the denormalized column — automation advances stages without a page visit, so
  // the column can lag; the stepper must never show a stale/misleading stage.
  const activeStage = stages.find((s) => s.status === 'active')?.kind ?? project.currentStage;
  const activePhase = stages.find((s) => s.kind === activeStage)?.lastPhase ?? undefined;

  // Per-stage → per-phase status straight from the details JSON, so the stepper's
  // sub-phase track can render skipped phases (subset runs) and block navigating to them.
  const detailStages = (project.details as {
    stages?: Record<string, { phases?: Record<string, { status?: string }> }>;
  } | null)?.stages;
  const phaseStatusByStage: Partial<Record<StageKind, Record<string, string>>> = {};
  if (detailStages) {
    for (const kind of STAGE_KIND) {
      const phases = detailStages[kind]?.phases;
      if (phases) {
        phaseStatusByStage[kind] = Object.fromEntries(
          Object.entries(phases).map(([k, v]) => [k, v.status ?? 'pending']),
        );
      }
    }
  }

  return (
    <PhaseFromRoute auto={project.autoMode}>
      <ShellHeader>
        <ProjectTopbar
          projectId={project.id}
          projectName={project.name}
          phase={project.phase}
          eventCount={events.length}
          canArchive={project.ownerId === actor.id}
          archived={project.archived}
        />
      </ShellHeader>
      <ShellSubNav className="!h-auto !py-3 !px-8 md:!px-12 lg:!px-16">
        <LiveStageStepper
          projectId={project.id}
          stages={stages}
          currentStage={activeStage}
          lockedStages={lockedStages}
          autoMode={project.autoMode}
          activePhase={activePhase}
          phaseStatusByStage={phaseStatusByStage}
        />
      </ShellSubNav>
      <ShellBody width="full" fill>
        <AutomationGate
          projectId={project.id}
          autoMode={project.autoMode}
          currentStage={activeStage ?? 'spec'}
          // `details` is already-parsed JSON, so reading through it cannot throw — the
          // try/catch that used to wrap this optional chain caught nothing.
          automationStartedAt={(project.details as { automation?: { startedAt?: string } } | null)?.automation?.startedAt}
          events={events}
        >
          {children}
        </AutomationGate>
      </ShellBody>
    </PhaseFromRoute>
  );
}
