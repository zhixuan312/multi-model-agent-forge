import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { recordReviewFix } from '@/automation/details-mutations';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { buildForgeBranch } from '@/build/execute-core';
import { projectWorktreePath } from '@/build/project-worktree';
// Git children run in checkouts MMA WORKERS write to, and several of these commands fire
// repo hooks (`push` → pre-push, worktree add/checkout → post-checkout). Inheriting the
// parent environment would hand a planted hook FORGE_SECRET_KEY, DATABASE_URL and every
// provider key. `safeChildEnv` keeps PATH and HOME, so git stays findable and any
// credential helper in ~/.gitconfig keeps working; only credential-shaped variables go.
import { safeChildEnv } from '@/build/command-runner';

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
  const [row] = await db
    .select({ details: project.details, name: project.name, createdAt: project.createdAt })
    .from(project)
    .where(eq(project.id, ctx.projectId))
    .limit(1);
  if (!row?.details) return;
  const d = validateDetails(row.details);
  const req = ctx.request as { repoId?: string } | null;
  const repoId = req?.repoId ?? d.repos[0]?.id;
  if (!repoId) return;

  await updateDetails(db, ctx.projectId, (det) => recordReviewFix(det, repoId, ctx.batchRowId, new Date().toISOString()));

  // Push the project branch so the PR reflects the fixes MMA committed. The project's own
  // worktree, not the shared clone — that is where the engine was pointed and committed.
  const repoPath = d.repos.find((r) => r.id === repoId)?.pathOnDisk;
  if (!repoPath) return;
  const cwd = projectWorktreePath(repoPath, ctx.projectId);
  try {
    const branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', env: safeChildEnv() as NodeJS.ProcessEnv }).trim();
    // Match THIS project's branch exactly, not just the `mma/` prefix. Several projects can
    // share one clone, so a prefix test would happily FORCE-push whichever project's branch
    // happened to be checked out — overwriting a sibling project's remote with our commits.
    // An exact match makes the wrong-checkout case a silent no-op (review fixes stop reaching
    // the PR) instead of destroying someone else's work; the mismatch is logged so it is
    // diagnosable rather than invisible.
    const expected = buildForgeBranch(row.name ?? ctx.projectId, row.createdAt);
    if (branch === expected) {
      execFileSync('git', ['-C', cwd, 'push', 'origin', branch, '--force'], { timeout: 60_000, env: safeChildEnv() as NodeJS.ProcessEnv });
    } else {
      console.error(`[forge] review-apply: ${cwd} is on "${branch}", expected "${expected}" — skipping push`);
    }
  } catch (pushErr) {
    console.error(`[forge] push after review-apply failed:`, pushErr);
  }
}

registerHandler('review-apply', handleReviewApply);
