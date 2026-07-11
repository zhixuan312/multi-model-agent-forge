import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { readSpecFile } from '@/projects/project-files';
import { parseSpecSections } from '@/spec/spec-file-ops';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

/**
 * Terminal handler for the mma-spec initial draft. The worker has already written
 * the whole spec.md (every requested component), so there is nothing to assemble
 * here — confirm it parsed and touch the project so the client refetch picks up
 * the freshly-drafted sections. Every section arrives "drafted" (Ready); questions
 * only arise later, from the per-component refine Q&A.
 */
async function handleSpecAutoDraft(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const specFile = await readSpecFile(ctx.projectId);
  if (!specFile) {
    throw new Error('MMA did not write spec.md. The spec task may have failed.');
  }
  const parsed = parseSpecSections(specFile.bodyMd);
  if (parsed.length === 0) {
    throw new Error('Spec file has no parseable sections.');
  }

  await db.update(project).set({ updatedAt: new Date() }).where(eq(project.id, ctx.projectId));
}

registerHandler('spec-auto-draft', handleSpecAutoDraft);
