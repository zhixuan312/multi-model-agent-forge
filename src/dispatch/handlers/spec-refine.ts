import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { SectionRefinementSchema } from '@/spec/schemas';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';


async function handleSpecRefine(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const parsed = SectionRefinementSchema.parse(JSON.parse(raw));
  const request = ctx.request as { componentId: string };
  const componentId = request.componentId;

  const [firstSection] = await db
    .select({ id: componentSection.id })
    .from(componentSection)
    .where(eq(componentSection.componentId, componentId))
    .orderBy(componentSection.orderIndex)
    .limit(1);
  if (firstSection) {
    await db
      .update(componentSection)
      .set({ draftMd: parsed.draftMd, updatedAt: new Date() })
      .where(eq(componentSection.id, firstSection.id));
  }

  const aiSatisfied = parsed.questions.length === 0;
  await db
    .update(component)
    .set({ aiSatisfied, status: 'drafted', updatedAt: new Date() })
    .where(eq(component.id, componentId));

  const [{ maxSeq }] = await db
    .select({ maxSeq: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId));
  const seq = (maxSeq ?? -1) + 1;

  const forgeReply = aiSatisfied
    ? '✅ Updated the draft with your feedback. I\'m satisfied — press "View spec" to review, then approve.'
    : `❓ A few more things to clarify:\n\n${parsed.questions.map((q: string) => `• ${q}`).join('\n\n')}`;
  await db.insert(qaMessage).values({
    componentId,
    seq,
    sender: 'forge',
    bodyMd: forgeReply,
    meta: { questions: parsed.questions },
  });
}

registerHandler('spec-refine', handleSpecRefine);
