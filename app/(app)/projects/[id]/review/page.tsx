import { notFound, redirect } from 'next/navigation';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { buildPr } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { ReviewStageClient, type ReviewPassView } from '@/components/forge/ReviewStageClient';
import { extractReviewFindings } from '@/review/review-findings';

export default async function ReviewStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ phase?: string }> }) {
  const { id } = await params;
  const { phase: urlPhase } = await searchParams;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id, teamId: me.teamId! });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const proj = await getProject(id);
  if (!proj) notFound();

  const db = getDb();

  // READ-ONLY render — do NOT activate the review stage or write current_stage on
  // visit. Stage progression is owned by the auto-driver and the /advance route; a
  // page refresh must never mutate stage state (it used to clobber an in-flight run).
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
    // Same parser the apply_review_findings effect uses, so a checked row's index maps
    // 1:1 to the finding the worker fixes.
    const findings = extractReviewFindings(b.result);

    const appliedForPass = applyBatches
      .filter((ab) => (ab.request as Record<string, unknown> | null)?.passNo === passNo)
      .flatMap((ab) => {
        const req = ab.request as Record<string, unknown> | null;
        return Array.isArray(req?.findingIndices) ? req.findingIndices as number[] : [];
      });

    return {
      passNo,
      status: (b.status === 'done' ? 'done' : 'failed') as 'done' | 'failed',
      findings,
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
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.handler, 'review-apply'), eq(mmaBatch.status, 'running')))
    .limit(1);

  const buildPrs = Object.fromEntries(
    (await db.select({ repoId: buildPr.repoId, url: buildPr.url, branch: buildPr.branch, targetBranch: buildPr.targetBranch })
      .from(buildPr).where(eq(buildPr.projectId, id)))
      .map(r => [r.repoId, { url: r.url, branch: r.branch, targetBranch: r.targetBranch }])
  );

  return (
    <ReviewStageClient
      projectId={id}
      projectName={proj.name}
      passes={passes}
      reviewRunning={!!runningReview}
      applyRunning={!!runningApply}
      buildPrs={buildPrs}
      autoMode={proj.autoMode}
      autoNote={proj.autoNote ?? ''}
      readOnly={!perms.review.canMutate}
    />
  );
}
