import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { project } from '@/db/schema/projects';
import { readSpecFile } from '@/projects/project-files';
import { parseSpecSections } from '@/spec/spec-file-ops';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { sanitizeUserVisibleMarkdown } from '@/lib/safe-markdown';

function extractNotes(envelope: unknown): string {
  // The MMA terminal summary may arrive as an object, a JSON string, or a
  // fenced ```json block. Normalize all three via extractJsonFromEnvelope, and
  // fall back to a direct object read if there is nothing JSON-shaped to parse.
  let obj: unknown;
  try {
    obj = JSON.parse(extractJsonFromEnvelope(envelope));
  } catch {
    obj = (envelope as { output?: { summary?: unknown } } | null)?.output?.summary;
  }
  if (!obj || typeof obj !== 'object') return '';
  const notes = (obj as { notes?: unknown }).notes;
  return typeof notes === 'string' ? notes.trim() : '';
}

// Preserved for future per-component AI Q&A recovery, but intentionally unused.
async function publishDormantComponentQuestions(): Promise<void> {}

async function handleSpecAutoDraft(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {

  const specFile = await readSpecFile(ctx.projectId);
  if (!specFile) {
    throw new Error('MMA did not write spec.md. The spec task may have failed.');
  }
  const parsed = parseSpecSections(specFile.bodyMd);
  if (parsed.length === 0) {
    throw new Error('Spec file has no parseable sections.');
  }

  const notes = extractNotes(envelope);
  if (notes) {
    const bodyMd = sanitizeUserVisibleMarkdown(`**Open Questions**\n\n${notes}`);
    const [{ maxSeq }] = await db
      .select({ maxSeq: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
      .from(qaMessage)
      .where(eq(qaMessage.targetId, ctx.projectId));

    const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
    const [row] = await db.insert(qaMessage).values({
      targetId: ctx.projectId,
      projectId: ctx.projectId,
      targetKind: 'spec_project',
      seq: (maxSeq ?? -1) + 1,
      authorId: FORGE_MEMBER_ID,
      bodyMd,
      meta: { source: 'mma-spec-notes' },
    }).returning({ id: qaMessage.id });

    // Publish the widened chat.message event so active collaborators see the
    // document-level open questions appear live (SpecStageClient listens for
    // scope 'spec_project'). Without this the row lands in the DB but never
    // reaches an open session until reload.
    const { projectEventBus } = await import('@/sse/event-bus');
    projectEventBus.publish(ctx.projectId, {
      type: 'chat.message',
      scope: 'spec_project',
      targetId: ctx.projectId,
      message: { id: row.id, sender: 'forge', authorId: FORGE_MEMBER_ID, authorName: 'Forge', bodyMd },
    });
  }

  await db.update(project).set({ updatedAt: new Date() }).where(eq(project.id, ctx.projectId));
}

registerHandler('spec-auto-draft', handleSpecAutoDraft);
