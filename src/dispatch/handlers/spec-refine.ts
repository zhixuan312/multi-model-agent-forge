import { eq, sql, asc } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { parseRefineResponse } from '@/spec/refine-prompt';

async function handleSpecRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const result = parseRefineResponse(raw);
  const request = ctx.request as { componentId: string };
  const componentId = request.componentId;

  // Update the section draft if Forge provided an updated version
  if (result.updatedSectionMd) {
    const [firstSection] = await db
      .select({ id: componentSection.id })
      .from(componentSection)
      .where(eq(componentSection.componentId, componentId))
      .orderBy(asc(componentSection.orderIndex))
      .limit(1);
    if (firstSection) {
      await db
        .update(componentSection)
        .set({ draftMd: result.updatedSectionMd, updatedAt: new Date() })
        .where(eq(componentSection.id, firstSection.id));
    }
  }

  await db
    .update(component)
    .set({ aiSatisfied: true, status: 'drafted', updatedAt: new Date() })
    .where(eq(component.id, componentId));

  // Save Forge's chat reply as a message
  const [{ maxSeq }] = await db
    .select({ maxSeq: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId));

  const [msgRow] = await db.insert(qaMessage).values({
    componentId,
    seq: (maxSeq ?? -1) + 1,
    sender: 'forge',
    bodyMd: result.chatReply,
    meta: result.updatedSectionMd ? { sectionUpdated: true } : { sectionUpdated: false },
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
      bodyMd: result.chatReply,
    },
  });
}

registerHandler('spec-refine', handleSpecRefine);
