import { eq, sql, asc } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parseRefineResponse } from '@/spec/refine-prompt';
import { replaceSpecSection } from '@/spec/spec-file-ops';

async function handleSpecRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parseRefineResponse(raw);
  const request = ctx.request as { componentId: string };
  const componentId = request.componentId;

  if (result.updatedSectionMd) {
    const [firstSection] = await db
      .select({ id: componentSection.id, label: componentSection.label })
      .from(componentSection)
      .where(eq(componentSection.componentId, componentId))
      .orderBy(asc(componentSection.orderIndex))
      .limit(1);
    if (firstSection) {
      await db
        .update(componentSection)
        .set({ draftMd: result.updatedSectionMd, updatedAt: new Date() })
        .where(eq(componentSection.id, firstSection.id));

      await replaceSpecSection(ctx.projectId, firstSection.label, result.updatedSectionMd);
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
