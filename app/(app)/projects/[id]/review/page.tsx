import { notFound, redirect } from 'next/navigation';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { mmaBatch } from '@/db/schema/mma';
import { repo } from '@/db/schema/workspace';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { ReviewStageClient } from '@/components/forge/ReviewStageClient';
import type { ReviewUnit, ReviewFinding } from '@/build/review-types';

export default async function ReviewStagePage({ params }: { params: Promise<{ id: string }> }) {
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

  // Load committed tasks as review units
  const tasks = await db
    .select({
      id: planTask.id,
      title: planTask.title,
      orderIndex: planTask.orderIndex,
      repoName: repo.name,
      status: planTask.status,
      branch: planTask.branch,
      commitSha: planTask.commitSha,
    })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id))
    .orderBy(planTask.orderIndex);

  const units: ReviewUnit[] = tasks.map((t, i) => ({
    id: t.id,
    num: i + 1,
    title: t.title,
    repo: t.repoName,
    files: [],
    commit: t.commitSha ?? '',
  }));

  // Load past review rounds from ops_mma_batch
  const reviewBatches = await db
    .select({ result: mmaBatch.result, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.status, 'done')))
    .orderBy(desc(mmaBatch.createdAt));

  const reviewRounds: ReviewFinding[][] = reviewBatches.map((b) => {
    const env = b.result as Record<string, unknown> | null;
    const output = (env?.output ?? {}) as Record<string, unknown>;
    const summary = output.summary as Record<string, unknown> | null;
    const findings = Array.isArray(summary?.findings) ? summary.findings as ReviewFinding[] : [];
    return findings;
  });

  return (
    <ReviewStageClient
      projectId={id}
      projectName={proj.name}
      phase={proj.phase as any}
      mmaReady={true}
      units={units}
      reviewRounds={reviewRounds}
    />
  );
}
