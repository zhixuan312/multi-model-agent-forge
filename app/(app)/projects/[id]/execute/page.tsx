import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { ExecuteStageClient, type ExecUnit } from '@/components/forge/ExecuteStageClient';

export default async function ExecuteStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const proj = await getProject(id);
  if (!proj) notFound();

  const db = getDb();
  const tasks = await db
    .select({
      id: planTask.id,
      title: planTask.title,
      orderIndex: planTask.orderIndex,
      repoName: repo.name,
      dependsOn: planTask.dependsOn,
      targetRepoId: planTask.targetRepoId,
    })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id))
    .orderBy(planTask.orderIndex);

  const units: ExecUnit[] = tasks.map((t, i) => ({
    id: t.id,
    num: i + 1,
    title: t.title,
    repo: t.repoName,
    dependsOn: (t.dependsOn ?? []) as string[],
    filesCount: 0,
  }));

  const writeTargets = [...new Set(tasks.map((t) => t.repoName))];

  return (
    <ExecuteStageClient
      projectId={id}
      projectName={proj.name}
      planVersion={1}
      phase={proj.phase as any}
      mmaReady={true}
      units={units}
      writeTargets={writeTargets}
    />
  );
}
