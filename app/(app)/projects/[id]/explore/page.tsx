import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { requireProjectAccess } from '@/projects/require-project-access';
import { isVoiceEnabled } from '@/config/connections-core';
import {
  latestBrief,
  readRailTasks,
  latestExplorationArtifact,
  readProjectRepoOptions,
} from '@/exploration/explore-core';
import { ExploreStageClient } from '@/components/forge/ExploreStageClient';
import { parseStagePhase, stagePhaseKeys } from '@/projects/stage-phases';

/**
 * Exploration stage — brain-dump → editable fan-out → live agent rail →
 * synthesized summary. RSC first paint hydrates the composer/tasks/artifact;
 * the client island drives propose/run/synthesize + voice and patches live
 * from `useProjectEvents` (opened by the project layout).
 * Membership-gated via `assertProjectReadable`.
 */
export default async function ExploreStagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ phase?: string }>;
}) {
  const { id } = await params;
  const { phase: phaseParam } = await searchParams;
  await requireProjectAccess(id);

  const db = getDb();
  const [proj] = await db
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  const [brief, tasks, artifact, repos] = await Promise.all([
    latestBrief(id, db),
    readRailTasks(id, db),
    latestExplorationArtifact(id),
    readProjectRepoOptions(id, db),
  ]);

  const voiceEnabled = await isVoiceEnabled({ db });

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  const { getActivePhase } = await import('@/projects/phase-tracker');
  const phases = stagePhaseKeys('exploration');
  const lastPhase = parseStagePhase('exploration', await getActivePhase(db, id, 'exploration'));
  // Unlike its sibling stages, Explore also CLAMPS: a phase further along than the stage
  // has actually reached is not linkable, so `?phase=synthesize` on a project still in
  // Brief lands on Brief rather than an empty synthesis panel.
  const urlPhase = parseStagePhase('exploration', phaseParam);
  const dbFurthestIdx = lastPhase ? phases.indexOf(lastPhase) : 0;
  const initialPhase = urlPhase && phases.indexOf(urlPhase) <= dbFurthestIdx
    ? urlPhase
    : lastPhase ?? undefined;

  return (
    <ExploreStageClient
      projectId={id}
      projectName={proj.name}
      initialBrief={brief}
      initialTasks={tasks}
      initialArtifact={artifact}
      repoOptions={repos}
      voiceEnabled={voiceEnabled}
      readOnly={!perms.explore.canMutate}
      lockedReason={perms.explore.reason}
      initialPhase={initialPhase}
    />
  );
}
