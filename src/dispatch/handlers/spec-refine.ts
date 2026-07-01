import { eq, sql, asc } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { stage } from '@/db/schema/projects';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parseRefineResponse } from '@/spec/refine-prompt';
import { assembleSpec } from '@/spec/assemble';

function splitByHeadings(md: string): Array<{ heading: string | null; body: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ heading: string | null; body: string }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (currentHeading !== null || currentLines.length > 0) {
        chunks.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
      }
      currentHeading = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentHeading !== null || currentLines.length > 0) {
    chunks.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
  }
  return chunks.filter((c) => c.body.length > 0 || c.heading);
}

async function handleSpecRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parseRefineResponse(raw);
  const request = ctx.request as { componentId: string };
  const componentId = request.componentId;

  if (result.updatedSectionMd) {
    const allSections = await db
      .select({ id: componentSection.id, label: componentSection.label })
      .from(componentSection)
      .where(eq(componentSection.componentId, componentId))
      .orderBy(asc(componentSection.orderIndex));

    const chunks = splitByHeadings(result.updatedSectionMd);

    if (chunks.length > 0 && allSections.length > 0) {
      if (chunks.length === 1 && !chunks[0].heading) {
        await db.update(componentSection)
          .set({ draftMd: chunks[0].body, updatedAt: new Date() })
          .where(eq(componentSection.id, allSections[0].id));
      } else {
        for (const chunk of chunks) {
          const label = chunk.heading?.replace(/^###\s*/, '').trim();
          const match = allSections.find((s) => s.label.toLowerCase() === label?.toLowerCase());
          if (match) {
            await db.update(componentSection)
              .set({ draftMd: chunk.body, updatedAt: new Date() })
              .where(eq(componentSection.id, match.id));
          }
        }
      }
    }

    // Re-assemble spec.md from all DB sections (same as auto-draft)
    const [specStage] = await db
      .select({ id: stage.id })
      .from(stage)
      .where(eq(stage.projectId, ctx.projectId));
    if (specStage) {
      await assembleSpec(db, ctx.projectId, specStage.id, ctx.actorId ?? 'system');
    }
  }

  const aiSatisfied = result.questions.length === 0;
  await db
    .update(component)
    .set({ aiSatisfied, status: 'drafted', updatedAt: new Date() })
    .where(eq(component.id, componentId));

  let forgeReply = result.chatReply;
  if (result.questions.length > 0) {
    forgeReply += `\n\n❓ A few things to clarify:\n\n${result.questions.map((q) => `• ${q}`).join('\n\n')}`;
  }

  const [{ maxSeq }] = await db
    .select({ maxSeq: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId));

  const [msgRow] = await db.insert(qaMessage).values({
    componentId,
    seq: (maxSeq ?? -1) + 1,
    sender: 'forge',
    bodyMd: forgeReply,
    meta: { sectionUpdated: !!result.updatedSectionMd, questions: result.questions },
  }).returning({ id: qaMessage.id });

  const { projectEventBus } = await import('@/sse/event-bus');
  projectEventBus.publish(ctx.projectId, {
    type: 'chat.message',
    componentId,
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
