import type { Db } from '@/db/client';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { readSpecFileAsync } from '@/projects/project-files';
import { updateDetails } from '@/details/write';

async function handleSpecAuditApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const specFile = await readSpecFileAsync(ctx.projectId);
  if (!specFile) {
    throw new Error('spec.md not found after audit-apply — MMA may have failed to write it.');
  }

  await updateDetails(db, ctx.projectId, (d) => {
    const passes = d.stages.spec.phases.finalize.auditPasses;
    const lastPass = passes[passes.length - 1];
    if (lastPass && !lastPass.fix) {
      lastPass.fix = { attempts: [{ batchId: ctx.batchRowId, status: 'done', at: new Date().toISOString() }] };
    }
    return d;
  });
}

registerHandler('spec-audit-apply', handleSpecAuditApply);
