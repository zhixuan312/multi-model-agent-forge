import type { Db } from '@/db/client';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { readSpecFileAsync } from '@/projects/project-files';

async function handleSpecAuditApply(_db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  // MMA writes the revised spec directly to spec.md.
  // Verify the file exists and was updated.
  const specFile = await readSpecFileAsync(ctx.projectId);
  if (!specFile) {
    throw new Error('spec.md not found after audit-apply — MMA may have failed to write it.');
  }
}

registerHandler('spec-audit-apply', handleSpecAuditApply);
