import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { teamSettings } from '@/db/schema/config';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import {
  latestBrief,
  readRailTasks,
  latestExplorationArtifact,
  readProjectRepoOptions,
} from '@/exploration/explore-core';
import { listAttachments } from '@/exploration/attachments';
import { ExploreStageClient } from '@/components/forge/ExploreStageClient';
import { USE_MOCK } from '@/mock/config';
import { mockExplore } from '@/mock/domains/projects/explore';

/**
 * Exploration stage (Spec 5) — brain-dump → editable fan-out → live agent rail →
 * synthesized summary. RSC first paint hydrates the composer/attachments/tasks/
 * artifact; the client island drives propose/run/synthesize + voice/attachments
 * and patches live from `useProjectEvents` (opened by the project layout).
 * Membership-gated via `assertProjectReadable`.
 */
export default async function ExploreStagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  // Mock mode: render the stage from seeded exploration content (no DB).
  if (USE_MOCK) {
    const data = mockExplore(id);
    return (
      <ExploreStageClient
        projectId={id}
        projectName={data.projectName}
        initialBrief={data.brief}
        initialAttachments={data.attachments}
        initialTasks={data.tasks}
        initialArtifact={data.artifact}
        repoOptions={data.repoOptions}
        voiceEnabled={data.voiceEnabled}
      />
    );
  }

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

  const [brief, attachments, tasks, artifact, repos] = await Promise.all([
    latestBrief(id, db),
    listAttachments(id, { db }),
    readRailTasks(id, db),
    latestExplorationArtifact(id, db),
    readProjectRepoOptions(id, db),
  ]);

  const [settings] = await db
    .select({ openaiRef: teamSettings.openaiTranscriptionKeyRef })
    .from(teamSettings)
    .limit(1);
  const voiceEnabled = Boolean(settings?.openaiRef);

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
    />
  );
}
