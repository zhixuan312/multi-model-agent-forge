import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { component, componentSection } from '@/db/schema/spec';
import type { ComponentKind } from '@/db/enums';
import { AnthropicClient, type CallUsage } from '@/anthropic/client';
import {
  FullSpecDraftSchema,
  SectionRefinementSchema,
  type FullSpecDraft,
  type FullSpecSection,
  type SectionRefinement,
} from '@/spec/schemas';
import { templateForKind, COMPONENT_TEMPLATES } from '@/spec/components';
import { recomputeComponentStatus, getLatestExploration } from '@/spec/orchestrator';
import { recordOrchestratorUsage } from '@/usage/record-orchestrator';
import { logPoll } from '@/observability/poll-log';

/**
 * Auto-draft (Approach C) — ONE main-agent call drafts ALL spec sections +
 * attaches 0-N questions per section. Sections with 0 questions are AI-satisfied.
 * Per-section refinement uses cheap calls scoped to the section only.
 */

export interface AutoDraftDeps {
  db?: Db;
  anthropic: Pick<AnthropicClient, 'parse' | 'parseWithUsage'>;
}

/* ── Full-spec draft (one call) ──────────────────────────────────────────── */

function buildFullDraftSystem(): string {
  return [
    'You are Forge\'s spec drafter. You receive a project intent, an exploration brief,',
    'and a spec outline (components + sections). Draft EVERY section and attach follow-up',
    'questions where the exploration brief leaves gaps.',
    '',
    'For each section:',
    '- Write clear, professional markdown grounded in the exploration findings.',
    '- Do NOT add headings — they are added automatically.',
    '- Attach 0-N questions: ask only when the exploration brief is genuinely insufficient.',
    '  If the brief already covers the section fully, return an empty questions array.',
    '- Be specific: name files, functions, libraries, and patterns from the exploration.',
    '',
    'Return ALL sections in the spec outline, in order.',
  ].join('\n');
}

function buildFullDraftUser(
  intentMd: string | null,
  explorationMd: string | null,
  outline: { componentKind: string; componentLabel: string; sectionKey: string; sectionLabel: string; prompt: string }[],
): string {
  const parts: string[] = [];
  parts.push(`# Project intent\n${intentMd ?? '(no intent captured)'}`);
  if (explorationMd) parts.push(`\n# Exploration brief\n${explorationMd}`);
  parts.push('\n# Spec outline — draft each section');
  for (const s of outline) {
    parts.push(`\n## ${s.componentLabel} > ${s.sectionLabel}`);
    parts.push(`componentKind: ${s.componentKind}`);
    parts.push(`sectionKey: ${s.sectionKey}`);
    parts.push(`Prompt: ${s.prompt}`);
  }
  return parts.join('\n');
}

export interface AutoDraftResult {
  ok: boolean;
  sections: FullSpecSection[];
  usage?: CallUsage;
  error?: string;
}

export async function autoDraftAll(
  deps: AutoDraftDeps & { projectId: string },
): Promise<AutoDraftResult> {
  const db = deps.db ?? getDb();

  // Load project intent + exploration brief
  const [proj] = await db
    .select({ intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, deps.projectId))
    .limit(1);
  const exploration = await getLatestExploration(db, deps.projectId);

  // Load the spec outline (components + sections in order)
  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, deps.projectId), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) return { ok: false, sections: [], error: 'No spec stage.' };

  const components = await db
    .select({ id: component.id, kind: component.kind, orderIndex: component.orderIndex })
    .from(component)
    .where(eq(component.stageId, specStage.id))
    .orderBy(component.orderIndex);

  const sections = await db
    .select({
      id: componentSection.id,
      componentId: componentSection.componentId,
      key: componentSection.key,
      label: componentSection.label,
      status: componentSection.status,
      orderIndex: componentSection.orderIndex,
    })
    .from(componentSection)
    .innerJoin(component, eq(componentSection.componentId, component.id))
    .where(eq(component.stageId, specStage.id))
    .orderBy(component.orderIndex, componentSection.orderIndex);

  if (sections.length === 0) return { ok: false, sections: [], error: 'No sections.' };

  // Build the outline for the prompt
  const compById = new Map(components.map((c) => [c.id, c]));
  const outline = sections.map((s) => {
    const comp = compById.get(s.componentId)!;
    const tpl = templateForKind(comp.kind as ComponentKind);
    const secTpl = tpl.sections.find((t) => t.key === s.key);
    return {
      componentKind: comp.kind,
      componentLabel: tpl.label,
      sectionKey: s.key,
      sectionLabel: s.label,
      prompt: secTpl?.prompt ?? s.label,
      sectionId: s.id,
      componentId: s.componentId,
    };
  });

  // ONE main agent call
  let draft: FullSpecDraft;
  let usage: CallUsage | undefined;
  try {
    const result = await deps.anthropic.parseWithUsage(FullSpecDraftSchema, {
      system: buildFullDraftSystem(),
      user: buildFullDraftUser(proj?.intentMd ?? null, exploration?.bodyMd ?? null, outline),
      call: 'fullSpecDraft',
      projectId: deps.projectId,
    });
    draft = result.data;
    usage = result.usage;
    await recordOrchestratorUsage(deps.projectId, 'fullSpecDraft', result.usage, { db }).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logPoll({ level: 'error', event: 'auto_draft.failure', detail: message });
    return { ok: false, sections: [], error: message };
  }

  // Apply drafts to DB sections
  for (const drafted of draft.sections) {
    const match = outline.find(
      (o) => o.componentKind === drafted.componentKind && o.sectionKey === drafted.sectionKey,
    );
    if (!match) continue;

    const aiSatisfied = drafted.questions.length === 0;
    await db
      .update(componentSection)
      .set({
        draftMd: drafted.draftMd,
        aiSatisfied,
        status: 'drafted',
        stale: false,
        updatedAt: new Date(),
      })
      .where(eq(componentSection.id, match.sectionId));
    await recomputeComponentStatus(db, match.componentId);
  }

  // Bump project updatedAt
  await db.update(project).set({ updatedAt: new Date() }).where(eq(project.id, deps.projectId));

  return { ok: true, sections: draft.sections, usage };
}

/* ── Per-section refinement (cheap call) ─────────────────────────────────── */

function buildRefinementSystem(componentLabel: string, sectionLabel: string, prompt: string): string {
  return [
    `You are Forge's spec refiner for the "${sectionLabel}" section of "${componentLabel}".`,
    `Section purpose: ${prompt}`,
    '',
    'You have the current draft and the user\'s feedback. Revise the draft to address',
    'their input. If you have further questions, ask them. If the section is now complete,',
    'return an empty questions array.',
  ].join('\n');
}

function buildRefinementUser(
  currentDraft: string,
  userAnswer: string,
  history: { role: 'forge' | 'user'; text: string }[],
): string {
  const parts: string[] = [];
  if (history.length > 0) {
    parts.push('# Conversation history');
    for (const m of history) {
      parts.push(`\n**${m.role === 'forge' ? 'Forge' : 'User'}:** ${m.text}`);
    }
  }
  parts.push(`\n# Current draft\n${currentDraft}`);
  parts.push(`\n# User's feedback\n${userAnswer}`);
  return parts.join('\n');
}

export interface RefineSectionDeps {
  db?: Db;
  anthropic: Pick<AnthropicClient, 'parse' | 'parseWithUsage'>;
}

export interface RefineSectionResult {
  draftMd: string;
  questions: string[];
}

export async function refineSection(
  deps: RefineSectionDeps & {
    sectionId: string;
    userAnswer: string;
    history: { role: 'forge' | 'user'; text: string }[];
  },
): Promise<RefineSectionResult> {
  const db = deps.db ?? getDb();

  const [section] = await db
    .select()
    .from(componentSection)
    .where(eq(componentSection.id, deps.sectionId))
    .limit(1);
  if (!section) throw new Error('Section not found.');

  const [comp] = await db
    .select()
    .from(component)
    .where(eq(component.id, section.componentId))
    .limit(1);
  if (!comp) throw new Error('Component not found.');

  const tpl = templateForKind(comp.kind as ComponentKind);
  const secTpl = tpl.sections.find((t) => t.key === section.key);

  const [stageRow] = await db
    .select({ projectId: stage.projectId })
    .from(component)
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(eq(component.id, section.componentId))
    .limit(1);

  const result = await deps.anthropic.parseWithUsage(SectionRefinementSchema, {
    system: buildRefinementSystem(tpl.label, section.label, secTpl?.prompt ?? ''),
    user: buildRefinementUser(section.draftMd ?? '', deps.userAnswer, deps.history),
    call: 'refineSection',
    projectId: stageRow?.projectId,
    section: `${comp.kind}:${section.key}`,
  });

  const aiSatisfied = result.data.questions.length === 0;
  await db
    .update(componentSection)
    .set({
      draftMd: result.data.draftMd,
      aiSatisfied,
      status: 'drafted',
      stale: false,
      updatedAt: new Date(),
    })
    .where(eq(componentSection.id, deps.sectionId));
  await recomputeComponentStatus(db, section.componentId);

  if (stageRow?.projectId) {
    await recordOrchestratorUsage(stageRow.projectId, 'refineSection', result.usage, { db }).catch(() => {});
  }

  return { draftMd: result.data.draftMd, questions: result.data.questions };
}
