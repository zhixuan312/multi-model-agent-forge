import type { Db } from '@/db/client';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { readSpecFile } from '@/projects/project-files';
import { updateDetails } from '@/details/write';
import { projectEventBus } from '@/sse/event-bus';

async function handleSpecAuditApply(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const specFile = await readSpecFile(ctx.projectId);
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

  // Same reason `spec-audit` publishes this: an auto-driven apply is dispatched
  // server-side, so the client's onDone tracking never fires and the Finalize rail would
  // show the pass as un-applied until a manual reload. The audit half published; the
  // apply half did not.
  projectEventBus.publish(ctx.projectId, { type: 'spec.updated' });
}

registerHandler('spec-audit-apply', handleSpecAuditApply);
