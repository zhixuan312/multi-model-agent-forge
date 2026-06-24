import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { project } from '@/db/schema/projects';
import { FullSpecDraftSchema } from '@/spec/schemas';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import type { OutlineEntry } from '@/spec/auto-draft';


function normalizeSections(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const obj = data as Record<string, unknown>;
  const sections = Array.isArray(obj.sections) ? obj.sections : [];
  return {
    sections: sections.map((s: unknown) => {
      if (!s || typeof s !== 'object') return s;
      const sec = s as Record<string, unknown>;
      const draftMd = (sec.draftMd ?? sec.draft_md ?? sec.draft ?? sec.content ?? sec.body ?? sec.text ?? sec.markdown ?? '') as string;
      const questions = Array.isArray(sec.questions)
        ? sec.questions.map((q: unknown) => typeof q === 'string' ? q : typeof q === 'object' && q ? (q as Record<string, unknown>).question ?? (q as Record<string, unknown>).text ?? JSON.stringify(q) : String(q))
        : [];
      return {
        componentKind: (sec.componentKind ?? sec.component_kind ?? '') as string,
        sectionKey: (sec.sectionKey ?? sec.section_key ?? '') as string,
        draftMd,
        questions,
      };
    }),
  };
}

async function handleSpecAutoDraft(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const parsed = FullSpecDraftSchema.parse(normalizeSections(JSON.parse(raw)));
  const request = ctx.request as { outline?: OutlineEntry[] };
  const outline = request.outline ?? [];

  const questionsByComponent = new Map<string, { questions: string[] }>();

  for (const drafted of parsed.sections) {
    const match = outline.find(
      (o) => o.componentKind === drafted.componentKind && o.sectionKey === drafted.sectionKey,
    );
    if (!match) continue;

    await db
      .update(componentSection)
      .set({ draftMd: drafted.draftMd, updatedAt: new Date() })
      .where(eq(componentSection.id, match.sectionId));

    const existing = questionsByComponent.get(match.componentId);
    if (existing) {
      existing.questions.push(...drafted.questions);
    } else {
      questionsByComponent.set(match.componentId, { questions: [...drafted.questions] });
    }
  }

  for (const [compId, { questions }] of questionsByComponent) {
    await db
      .update(component)
      .set({ aiSatisfied: questions.length === 0, status: 'drafted', updatedAt: new Date() })
      .where(eq(component.id, compId));
  }

  for (const [compId, { questions }] of questionsByComponent) {
    await db.delete(qaMessage).where(eq(qaMessage.componentId, compId));
    const forgeBody = questions.length > 0
      ? `❓ I've drafted this but would like to clarify:\n\n${questions.map((q) => `• ${q}`).join('\n\n')}`
      : '✅ This looks complete. You can approve it, or tell me what to change.';
    await db.insert(qaMessage).values({
      componentId: compId,
      seq: 0,
      sender: 'forge',
      bodyMd: forgeBody,
      meta: { autoDraft: true, questions },
    });
  }

  await db.update(project).set({ updatedAt: new Date() }).where(eq(project.id, ctx.projectId));
}

registerHandler('spec-auto-draft', handleSpecAutoDraft);
