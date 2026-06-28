import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import type { Db } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleReviewApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const request = ctx.request as { repoId?: string; cwd?: string };
  const cwd = request.cwd;
  if (!cwd) return;

  // Push the forge branch to update the PR
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
