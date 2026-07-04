import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { recordReviewFix } from '@/automation/details-mutations';
import { GitOps } from '@/build/branch';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

/**
 * After review findings are applied: COMMIT the fixes onto the project branch,
 * record the fix on the latest review pass in `details.reviewPasses` (the SINGLE
 * writer of that gating state, for both the manual "Apply" button and the auto
 * driver), then push so the PR reflects them. The review-apply worker runs
 * `reviewPolicy=none` — it EDITS repo files but NEVER commits — so without the
 * commit here the fixes stay uncommitted (dirty tree, PR missing them, and the
 * next review pass reviews stranded working-tree changes). `repoId` comes from the
 * dispatch meta; the single-repo sync path falls back to the sole repo, and cwd is
 * derived from the repo (not the request) so it works regardless of trigger.
 */
async function handleReviewApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  if (!row?.details) return;
  const d = validateDetails(row.details);
  const req = ctx.request as { repoId?: string } | null;
  const repoId = req?.repoId ?? d.repos[0]?.id;
  if (!repoId) return;

  const cwd = d.repos.find((r) => r.id === repoId)?.pathOnDisk;

  // Commit the applied fixes BEFORE recording the pass / pushing — the worker left
  // them uncommitted in the working tree. Pass number = review passes so far.
  if (cwd) {
    const passNo = d.stages.review.phases.review.repos.find((r) => r.repoId === repoId)?.reviewPasses.length ?? 0;
    try {
      await new GitOps().commitAllIfDirty(cwd, `review: apply findings (pass ${passNo})`);
    } catch (commitErr) {
      console.error(`[forge] review-apply commit failed:`, commitErr);
    }
  }

  await updateDetails(db, ctx.projectId, (det) => recordReviewFix(det, repoId, ctx.batchRowId, new Date().toISOString()));

  // Push the project branch so the PR reflects the fixes.
  if (!cwd) return;
  try {
    const branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    if (branch.startsWith('forge/')) {
      execFileSync('git', ['-C', cwd, 'push', 'origin', branch, '--force'], { timeout: 60_000 });
    }
  } catch (pushErr) {
    console.error(`[forge] push after review-apply failed:`, pushErr);
  }
}

registerHandler('review-apply', handleReviewApply);
