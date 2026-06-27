import { eq, and } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection } from '@/db/schema/spec';
import { mmaBatch } from '@/db/schema/mma';
import { stage } from '@/db/schema/projects';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { replaceSpecSection } from '@/spec/spec-file-ops';


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

  const [sec] = await db
    .select({ label: componentSection.label })
    .from(componentSection)
    .where(and(eq(componentSection.componentId, comp.id), eq(componentSection.key, request.sectionKey)));

  // Write to DB (keeps metadata in sync)
  await db
    .update(componentSection)
    .set({ draftMd: parsed.draftMd, updatedAt: new Date() })
    .where(and(eq(componentSection.componentId, comp.id), eq(componentSection.key, request.sectionKey)));

  // Write directly to spec.md (source of truth)
  if (sec) {
    await replaceSpecSection(ctx.projectId, sec.label, parsed.draftMd);
  }

  // Check if all sibling audit-apply batches for this project are done.
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

  if (pending.length <= 1) {
    // Last section done — no need to reassemble, spec.md was updated in-place
  }
}

registerHandler('spec-audit-apply', handleSpecAuditApply);
