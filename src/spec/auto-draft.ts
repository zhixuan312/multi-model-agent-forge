import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
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
  return `You are Forge's spec drafter. You receive a project intent, an exploration brief, and a spec outline (components + sections). Draft EVERY section and attach follow-up questions where the exploration brief leaves gaps.

For each section:
- Do NOT add headings — they are added automatically.
- Attach 0-N questions: ask only when the exploration brief is genuinely insufficient. If the brief already covers the section fully, return an empty questions array.
- Ground your draft in the exploration findings, but ADAPT THE LANGUAGE TO THE AUDIENCE.

Audience rules — each section lists its primary roles:
- **BO (Business Owner) / PM (Product Manager)**: Write in plain business language. NO code references, file paths, line numbers, SQL syntax, or engineering jargon. Describe WHAT the system does and WHY, not HOW it's implemented. A non-technical stakeholder must be able to read and approve it.
- **SWE (Software Engineer)**: Technical detail is expected. Name files, functions, libraries, patterns, and architecture decisions. Reference the exploration findings directly.
- **Mixed roles (e.g. PM + SWE)**: Lead with the business context in plain language, then add a technical details subsection for engineers.

Return ALL sections in the spec outline, in order.`;
}

function buildFullDraftUser(
  intentMd: string | null,
  explorationMd: string | null,
  outline: { componentKind: string; componentLabel: string; sectionKey: string; sectionLabel: string; prompt: string; roles: string[] }[],
): string {
  const parts: string[] = [];
  parts.push(`# Project intent\n${intentMd ?? '(no intent captured)'}`);
  if (explorationMd) parts.push(`\n# Exploration brief\n${explorationMd}`);
  parts.push('\n# Spec outline — draft each section');
  for (const s of outline) {
    parts.push(`\n## ${s.componentLabel} > ${s.sectionLabel}`);
    parts.push(`componentKind: ${s.componentKind}`);
    parts.push(`sectionKey: ${s.sectionKey}`);
    parts.push(`Audience: ${s.roles.join(', ') || 'SWE'}`);
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

  // Only draft sections from non-approved components
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
    .where(and(eq(component.stageId, specStage.id), sql`${component.status} != 'approved'`))
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
      roles: tpl.primaryRoles,
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

  // Apply drafts to DB sections — collect questions per component
  const questionsByComponent = new Map<string, { questions: string[]; firstSectionId: string }>();

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

    // Accumulate questions per component
    const existing = questionsByComponent.get(match.componentId);
    if (existing) {
      existing.questions.push(...drafted.questions);
    } else {
      questionsByComponent.set(match.componentId, { questions: [...drafted.questions], firstSectionId: match.sectionId });
    }
  }

  // Insert ONE Forge message per component (on the first section)
  for (const [, { questions, firstSectionId }] of questionsByComponent) {
    const forgeBody = questions.length > 0
      ? `❓ I've drafted this but have a few questions:\n${questions.map((q, i) => `Q${i + 1}: ${q}`).join('\n')}`
      : '✅ This looks complete. You can approve it, or tell me what to change.';
    await db.insert(qaMessage).values({
      sectionId: firstSectionId,
      seq: 0,
      sender: 'forge',
      bodyMd: forgeBody,
      meta: { autoDraft: true, questions },
    });
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

  // Persist user message
  const [{ maxSeq }] = await db
    .select({ maxSeq: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
    .from(qaMessage)
    .where(eq(qaMessage.sectionId, deps.sectionId));
  let seq = (maxSeq ?? -1) + 1;
  await db.insert(qaMessage).values({
    sectionId: deps.sectionId,
    seq,
    sender: 'member',
    bodyMd: deps.userAnswer,
  });
  seq++;

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

  // Persist Forge reply
  const forgeReply = aiSatisfied
    ? '✅ Updated the draft with your feedback. I\'m satisfied with this section — press "Construct section" to review, then approve.'
    : result.data.questions.map((q, i) => `Q${i + 1}: ${q}`).join('\n');
  await db.insert(qaMessage).values({
    sectionId: deps.sectionId,
    seq,
    sender: 'forge',
    bodyMd: forgeReply,
    meta: { questions: result.data.questions },
  });

  if (stageRow?.projectId) {
    await recordOrchestratorUsage(stageRow.projectId, 'refineSection', result.usage, { db }).catch(() => {});
  }

  return { draftMd: result.data.draftMd, questions: result.data.questions };
}
