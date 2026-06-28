import { notFound, redirect } from 'next/navigation';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { ReviewStageClient, type ReviewPassView } from '@/components/forge/ReviewStageClient';

export default async function ReviewStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ phase?: string }> }) {
  const { id } = await params;
  const { phase: urlPhase } = await searchParams;
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

  // Activate the review stage on visit
  const { stage, project: projectTable } = await import('@/db/schema/projects');
  const { and: deq2, eq: deq } = await import('drizzle-orm');
  await db.update(stage).set({ status: 'active' }).where(deq2(deq(stage.projectId, id), deq(stage.kind, 'review'), deq(stage.status, 'pending')));
  await db.update(projectTable).set({ currentStage: 'review' }).where(eq(projectTable.id, id));

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  // Load review batches → passes
  const reviewBatches = await db
    .select({ id: mmaBatch.id, result: mmaBatch.result, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  // Load apply batches
  const applyBatches = await db
    .select({ request: mmaBatch.request, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.handler, 'review-apply'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  const passes: ReviewPassView[] = reviewBatches.map((b, i) => {
    const passNo = i + 1;
    const env = b.result as Record<string, unknown> | null;
    const output = (env?.output ?? {}) as Record<string, unknown>;
    let summary = output.summary;
    if (typeof summary === 'string') {
      try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch {}
    }
    const summaryObj = (summary && typeof summary === 'object' ? summary : {}) as Record<string, unknown>;
    const findings = Array.isArray(summaryObj.findings) ? summaryObj.findings as Array<Record<string, unknown>> : [];

    const appliedForPass = applyBatches
      .filter((ab) => (ab.request as Record<string, unknown> | null)?.passNo === passNo)
      .flatMap((ab) => {
        const req = ab.request as Record<string, unknown> | null;
        return Array.isArray(req?.findingIndices) ? req.findingIndices as number[] : [];
      });

    return {
      passNo,
      status: (b.status === 'done' ? 'done' : 'failed') as 'done' | 'failed',
      findings: findings.map((f) => ({
        weight: (f.weight as string) ?? 'medium',
        category: (f.category as string) ?? '',
        claim: (f.claim as string) ?? '',
        evidence: (f.evidence as string) ?? '',
        file: (f.file as string) ?? '',
        line: typeof f.line === 'number' ? f.line : 0,
        suggestion: (f.suggestion as string) ?? '',
      })),
      appliedIndices: [...new Set(appliedForPass)],
    };
  });

  // Check if there's a running review or apply
  const [runningReview] = await db
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'running')))
    .limit(1);
  const [runningApply] = await db
    .select({ id: mmaBatch.id, request: mmaBatch.request })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.handler, 'review-apply'), eq(mmaBatch.status, 'running')))
    .limit(1);

  const applyCount = runningApply
    ? ((runningApply.request as Record<string, unknown> | null)?.findingsCount as number ?? 0)
    : 0;

  const buildPrs = (proj.buildPrs ?? {}) as Record<string, { url: string; branch: string; targetBranch: string }>;

  return (
    <ReviewStageClient
      projectId={id}
      projectName={proj.name}
      phase={proj.phase as any}
      passes={passes}
      reviewRunning={!!runningReview}
      applyRunning={!!runningApply}
      applyCount={applyCount}
      buildPrs={buildPrs}
      readOnly={!perms.review.canMutate}
    />
  );
}
