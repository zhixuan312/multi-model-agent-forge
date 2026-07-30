import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { recordReviewFix } from '@/automation/details-mutations';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

/**
 * After review findings are applied: record the fix on the latest review pass in
 * `details.reviewPasses` (the SINGLE writer of that gating state, for both the
 * manual "Apply" button and the auto driver), then push the project branch so the
 * PR reflects the fixes. The fixes are dispatched on the `delegate` route, which edits the
 * checked-out `mma/…` branch IN PLACE and commits there — MMA owns the commit, Forge does
 * not. (Before caller-owned branches this went through an engine worktree that was
 * force-committed and ff-merged back; the commit ownership is unchanged.) `repoId` comes from the
 * dispatch meta; the single-repo sync path falls back to the sole repo, and cwd is
 * derived from the repo (not the request) so the push works regardless of trigger.
 */
async function handleReviewApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  if (!row?.details) return;
  const d = validateDetails(row.details);
  const req = ctx.request as { repoId?: string } | null;
  const repoId = req?.repoId ?? d.repos[0]?.id;
  if (!repoId) return;

  await updateDetails(db, ctx.projectId, (det) => recordReviewFix(det, repoId, ctx.batchRowId, new Date().toISOString()));

  // Push the project branch so the PR reflects the fixes MMA committed.
  const cwd = d.repos.find((r) => r.id === repoId)?.pathOnDisk;
  if (!cwd) return;
  try {
    const branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    // Guard the prefix so we only ever force-push a branch Forge created. This is the ONLY
    // runtime branch-prefix check in the codebase and it gates a FORCE push, so a stale prefix
    // fails silently — review fixes simply stop reaching the PR — rather than erroring.
    if (branch.startsWith('mma/')) {
      execFileSync('git', ['-C', cwd, 'push', 'origin', branch, '--force'], { timeout: 60_000 });
    }
  } catch (pushErr) {
    console.error(`[forge] push after review-apply failed:`, pushErr);
  }
}

registerHandler('review-apply', handleReviewApply);
