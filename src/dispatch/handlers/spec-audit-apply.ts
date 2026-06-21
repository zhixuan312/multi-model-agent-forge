import { eq, and } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection } from '@/db/schema/spec';
import { mmaBatch } from '@/db/schema/mma';
import { stage } from '@/db/schema/projects';
import { assembleSpec } from '@/spec/assemble';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';


async function handleSpecAuditApply(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const parsed = JSON.parse(raw) as { draftMd: string };
  if (typeof parsed.draftMd !== 'string') throw new Error('Response missing draftMd');

  const request = ctx.request as {
    componentKind: string;
    sectionKey: string;
    actorId?: string;
    totalSections: number;
  };

  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, ctx.projectId), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) return;

  const [comp] = await db
    .select({ id: component.id })
    .from(component)
    .where(and(eq(component.stageId, specStage.id), eq(component.kind, request.componentKind as any)))
    .limit(1);
  if (!comp) return;

  await db
    .update(componentSection)
    .set({ draftMd: parsed.draftMd, updatedAt: new Date() })
    .where(and(eq(componentSection.componentId, comp.id), eq(componentSection.key, request.sectionKey)));

  // Check if all sibling audit-apply batches for this project are done.
  // If this is the last one, re-assemble the spec.
  const pending = await db
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, ctx.projectId),
        eq(mmaBatch.handler, 'spec-audit-apply'),
        eq(mmaBatch.status, 'running'),
      ),
    );

  // Current batch is still 'running' in the DB (handler runs inside the transaction
  // before status flips to 'done'). So pending count of 1 means this is the last one.
  if (pending.length <= 1) {
    await assembleSpec(db, ctx.projectId, specStage.id, request.actorId ?? 'system');
  }
}

registerHandler('spec-audit-apply', handleSpecAuditApply);
