import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { isVoiceEnabled } from '@/config/connections-core';
import {
  latestBrief,
  readRailTasks,
  latestExplorationArtifact,
  readProjectRepoOptions,
} from '@/exploration/explore-core';
import { listAttachments } from '@/exploration/attachments';
import { findPendingHandlers } from '@/dispatch/dispatch-helpers';
import { ExploreStageClient } from '@/components/forge/ExploreStageClient';

/**
 * Exploration stage — brain-dump → editable fan-out → live agent rail →
 * synthesized summary. RSC first paint hydrates the composer/attachments/tasks/
 * artifact; the client island drives propose/run/synthesize + voice/attachments
 * and patches live from `useProjectEvents` (opened by the project layout).
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
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();
  const [proj] = await db
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  const [brief, attachments, tasks, artifact, repos, pendingHandlers] = await Promise.all([
    latestBrief(id, db),
    listAttachments(id, { db }),
    readRailTasks(id, db),
    latestExplorationArtifact(id),
    readProjectRepoOptions(id, db),
    findPendingHandlers(db, id),
  ]);

  const voiceEnabled = await isVoiceEnabled({ db });

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  const { getLastPhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getLastPhase(db, id, 'exploration') as 'brief' | 'discover' | 'synthesize' | null;
  const validPhases = ['brief', 'discover', 'synthesize'] as const;
  const dbFurthestIdx = lastPhase ? validPhases.indexOf(lastPhase) : 0;
  const urlPhaseIdx = phaseParam && validPhases.includes(phaseParam as any)
    ? validPhases.indexOf(phaseParam as typeof validPhases[number])
    : -1;
  const initialPhase = urlPhaseIdx >= 0 && urlPhaseIdx <= dbFurthestIdx
    ? (phaseParam as typeof validPhases[number])
    : lastPhase ?? undefined;

  return (
    <ExploreStageClient
      projectId={id}
      projectName={proj.name}
      initialBrief={brief}
      initialAttachments={attachments}
      initialTasks={tasks}
      initialArtifact={artifact}
      repoOptions={repos}
      voiceEnabled={voiceEnabled}
      canMutate={perms.explore.canMutate}
      lockedReason={perms.explore.reason}
      pendingHandlers={pendingHandlers}
      initialPhase={initialPhase}
    />
  );
}
