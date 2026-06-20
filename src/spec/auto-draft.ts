import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { getLatestExploration } from '@/spec/orchestrator';
import { mmaBatch } from '@/db/schema/mma';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
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
- Attach 0-N questions: ask when the exploration brief leaves genuine gaps. Ask ALL your questions at once — do not hold back. If you have 3 concerns, ask all 3. If the brief already covers the section fully, return an empty questions array.
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
    // Record the failed call so it shows in usage
    await db.insert(mmaBatch).values({
      projectId: deps.projectId,
      route: 'orchestrate',
      cwd: resolveWorkspaceRoot(),
      status: 'failed',
      request: { call: 'fullSpecDraft' },
      result: { error: message },
      implementerTier: 'main',
      terminalAt: new Date(),
    }).catch(() => {});
    return { ok: false, sections: [], error: message };
  }

  // Apply drafts to DB sections — collect questions per component
  const questionsByComponent = new Map<string, { questions: string[] }>();

  for (const drafted of draft.sections) {
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

  // Set status + aiSatisfied on the COMPONENT directly
  for (const [compId, { questions }] of questionsByComponent) {
    await db
      .update(component)
      .set({ aiSatisfied: questions.length === 0, status: 'drafted', updatedAt: new Date() })
      .where(eq(component.id, compId));
  }

  // Clear old qa_messages and insert ONE fresh Forge message per component
  for (const [compId, { questions }] of questionsByComponent) {
    // Delete all old messages for this component
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
    componentId: string;
    userAnswer: string;
    history: { role: 'forge' | 'user'; text: string }[];
  },
): Promise<RefineSectionResult> {
  const db = deps.db ?? getDb();

  const [comp] = await db
    .select()
    .from(component)
    .where(eq(component.id, deps.componentId))
    .limit(1);
  if (!comp) throw new Error('Component not found.');

  const tpl = templateForKind(comp.kind as ComponentKind);

  const [stageRow] = await db
    .select({ projectId: stage.projectId })
    .from(component)
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(eq(component.id, deps.componentId))
    .limit(1);

  // Get current draft (all sections combined)
  const sections = await db
    .select({ draftMd: componentSection.draftMd })
    .from(componentSection)
    .where(eq(componentSection.componentId, deps.componentId));
  const currentDraft = sections.filter((s) => s.draftMd).map((s) => s.draftMd!).join('\n\n');

  // Persist user message
  const [{ maxSeq }] = await db
    .select({ maxSeq: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
    .from(qaMessage)
    .where(eq(qaMessage.componentId, deps.componentId));
  let seq = (maxSeq ?? -1) + 1;
  await db.insert(qaMessage).values({
    componentId: deps.componentId,
    seq,
    sender: 'member',
    bodyMd: deps.userAnswer,
  });
  seq++;

  const result = await deps.anthropic.parseWithUsage(SectionRefinementSchema, {
    system: buildRefinementSystem(tpl.label, tpl.label, tpl.sections.map((s) => s.prompt).join('; ')),
    user: buildRefinementUser(currentDraft, deps.userAnswer, deps.history),
    call: 'refineSection',
    projectId: stageRow?.projectId,
    section: comp.kind,
  });

  // Update all sections with the new draft (store as single block on first section)
  const [firstSection] = await db
    .select({ id: componentSection.id })
    .from(componentSection)
    .where(eq(componentSection.componentId, deps.componentId))
    .orderBy(componentSection.orderIndex)
    .limit(1);
  if (firstSection) {
    await db
      .update(componentSection)
      .set({ draftMd: result.data.draftMd, updatedAt: new Date() })
      .where(eq(componentSection.id, firstSection.id));
  }
  // Set aiSatisfied on the component directly
  const aiSatisfied = result.data.questions.length === 0;
  await db
    .update(component)
    .set({ aiSatisfied, status: 'drafted', updatedAt: new Date() })
    .where(eq(component.id, deps.componentId));

  // Persist Forge reply
  const forgeReply = aiSatisfied
    ? '✅ Updated the draft with your feedback. I\'m satisfied — press "Show draft" to review, then approve.'
    : `❓ A few more things to clarify:\n\n${result.data.questions.map((q) => `• ${q}`).join('\n\n')}`;
  await db.insert(qaMessage).values({
    componentId: deps.componentId,
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
