import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { qaMessage } from '@/db/schema/spec';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parseRefineResponse } from '@/spec/refine-prompt';
import { backupArtifact, readSpecFile, writeSpec } from '@/projects/project-files';
import { parseSpecSections } from '@/spec/spec-file-ops';

function splitByHeadings(md: string): Array<{ heading: string; body: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ heading: string; body: string }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (currentHeading) {
        chunks.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
      }
      currentHeading = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentHeading) {
    chunks.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
  }
  return chunks;
}

async function handleSpecRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parseRefineResponse(raw);
  const request = ctx.request as { componentId: string };
  const componentId = request.componentId;

  if (result.updatedSectionMd) {
    const chunks = splitByHeadings(result.updatedSectionMd);
    if (chunks.length > 0) {
      // Build a replacement map from the MMA response
      const replacements = new Map<string, string>();
      for (const chunk of chunks) {
        const label = chunk.heading.replace(/^###\s*/, '').trim().toLowerCase();
        replacements.set(label, chunk.body);
      }

      await backupArtifact(ctx.projectId, 'spec.md');
      const file = await readSpecFile(ctx.projectId);
      if (file) {
        const allSections = parseSpecSections(file.bodyMd);
        const lines = file.bodyMd.split('\n');
        // Apply replacements from last to first to preserve line numbers
        const sorted = allSections
          .filter((s) => replacements.has(s.heading.replace(/^###\s*/, '').trim().toLowerCase()))
          .sort((a, b) => b.startLine - a.startLine);
        for (const sec of sorted) {
          const label = sec.heading.replace(/^###\s*/, '').trim().toLowerCase();
          const newBody = replacements.get(label)!;
          const replacement = [sec.heading, '', newBody.trim(), ''];
          lines.splice(sec.startLine, sec.endLine - sec.startLine + 1, ...replacement);
        }
        await writeSpec(ctx.projectId, lines.join('\n'));
      }
    }
  }

  // Component status derived from details.approvals — no legacy table update

  let forgeReply = result.chatReply;
  if (result.questions.length > 0) {
    forgeReply += `\n\n❓ A few things to clarify:\n\n${result.questions.map((q) => `• ${q}`).join('\n\n')}`;
  }

  // seq computed inside the insert (single statement) — avoids the concurrent SELECT-max/INSERT
  // collision (non-unique index → duplicate seq → ambiguous chat ordering).
  const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
  const [msgRow] = await db.insert(qaMessage).values({
    targetId: componentId,
    projectId: ctx.projectId,
    targetKind: 'spec_component',
    seq: sql<number>`(select coalesce(max(${qaMessage.seq}), -1) + 1 from ${qaMessage} where ${qaMessage.targetId} = ${componentId})`,
    authorId: FORGE_MEMBER_ID,
    bodyMd: forgeReply,
    meta: { sectionUpdated: !!result.updatedSectionMd, questions: result.questions },
  }).returning({ id: qaMessage.id });

  const { projectEventBus } = await import('@/sse/event-bus');
  projectEventBus.publish(ctx.projectId, {
    type: 'chat.message',
    scope: 'spec_component',
    targetId: componentId,
    message: {
      id: msgRow.id,
      sender: 'forge',
      authorId: 'forge',
      authorName: 'Forge',
      bodyMd: forgeReply,
    },
  });
}

registerHandler('spec-refine', handleSpecRefine);
