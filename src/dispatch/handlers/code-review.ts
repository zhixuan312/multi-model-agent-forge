import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { recordReviewPass } from '@/automation/details-mutations';
import { hasBlockingReviewFindings } from '@/review/review-findings';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

/**
 * On a completed code review, record the pass into `details.reviewPasses` — the
 * SINGLE writer of the resolver's review-gating state, for BOTH the manual "Run
 * review" button and the auto driver. Both triggers go through this handler, so
 * the resolver always sees a consistent review state and manual↔auto switching
 * mid-review never loses progress. (The review UI still renders finding detail
 * from the batch `result`; details holds the pass structure/status the resolver
 * reads.) `repoId` comes from the dispatch meta; for a single-repo project the
 * sync path (no meta on ctx.request) falls back to the sole repo.
 */
async function handleCodeReview(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  if (!row?.details) return;
  const req = ctx.request as { repoId?: string } | null;
  const repoId = req?.repoId ?? validateDetails(row.details).repos[0]?.id;
  if (!repoId) return;
  const blocking = hasBlockingReviewFindings(envelope);
  await updateDetails(db, ctx.projectId, (d) => recordReviewPass(d, repoId, ctx.batchRowId, blocking, new Date().toISOString()));
}

registerHandler('code-review', handleCodeReview);
