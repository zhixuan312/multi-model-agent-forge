import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { artifact } from '@/db/schema/artifacts';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import type { ComponentSectionRow, QaMessageRow, ComponentRow } from '@/db/schema/spec';
import {
  type ComponentKind,
  type ComponentStatus,
} from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { AnthropicClient } from '@/anthropic/client';
import {
  GenerateQuestionsSchema,
  AssessAnswersSchema,
  DraftSectionSchema,
  type GenerateQuestions,
  type AssessAnswers,
  type DraftSection,
} from '@/spec/schemas';
import { templateForKind, COMPONENT_TEMPLATES } from '@/spec/components';
import { deriveSummary } from '@/spec/summary';

/**
 * Interview orchestrator (Spec 4 / lib/spec/orchestrator.ts) — the code-owned
 * per-section loop. Pure functions over DB state + an injected `AnthropicClient`
 * (no Agent SDK, no MMA). Implements the dual AI/Human satisfaction gate, the
 * zero-question fast path, force-advance, and the `stale` re-draft rule.
 *
 * THE DUAL GATE INVARIANT (Goal / §8.3): a section reaches `approved` ONLY via
 * (ai_satisfied && human_satisfied) OR forced. `human_satisfied=true` alone is
 * NEVER sufficient. `ai_satisfied` is set ONLY by the model; `human_satisfied`
 * ONLY by an explicit human action or force-advance.
 */

/** The exact placeholder written when a forced section's draft generation fails (F7). */
export const FORCED_DRAFT_PLACEHOLDER =
  '_Draft generation failed — force-advanced; fill in manually before freeze._';

export interface OrchestratorDeps {
  db?: Db;
  anthropic: AnthropicClient;
}

/** Optional grounding the orchestrator passes to the model (intent + exploration). */
interface Grounding {
  intentMd: string | null;
  explorationMd: string | null;
}

/** A section + its component, the unit the loop operates on. */
interface SectionContext {
  section: ComponentSectionRow;
  component: ComponentRow;
}

/* ── Grounding + prompt assembly ────────────────────────────────────────── */

/** Resolve the project + latest exploration artifact body for grounding. */
async function loadGrounding(db: Db, projectId: string): Promise<Grounding> {
  const [proj] = await db
    .select({ intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  const exploration = await getLatestExploration(db, projectId);
  return { intentMd: proj?.intentMd ?? null, explorationMd: exploration?.bodyMd ?? null };
}

/** The latest `artifact(kind='exploration', version=max)` for grounding, or null (Spec 5 writes it). */
export async function getLatestExploration(
  db: Db,
  projectId: string,
): Promise<{ bodyMd: string } | null> {
  const [row] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')))
    .orderBy(sql`${artifact.version} desc`)
    .limit(1);
  return row ?? null;
}

/** Approved sibling sections' drafts in the same project (for coherence). */
async function approvedSiblingDrafts(db: Db, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ label: componentSection.label, draftMd: componentSection.draftMd })
    .from(componentSection)
    .innerJoin(component, eq(componentSection.componentId, component.id))
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(
      and(
        eq(stage.projectId, projectId),
        eq(component.status, 'approved'),
        sql`${componentSection.draftMd} is not null`,
      ),
    );
  return rows.filter((r) => r.draftMd).map((r) => `### ${r.label}\n${r.draftMd}`);
}

/** The component's full qa_message transcript, in seq order. */
async function loadTranscript(db: Db, componentId: string): Promise<QaMessageRow[]> {
  return db
    .select()
    .from(qaMessage)
    .where(eq(qaMessage.componentId, componentId))
    .orderBy(asc(qaMessage.seq));
}

/** Resolve a section + its component row. */
async function loadSectionContext(db: Db, sectionId: string): Promise<SectionContext> {
  const [section] = await db
    .select()
    .from(componentSection)
    .where(eq(componentSection.id, sectionId))
    .limit(1);
  if (!section) throw new Error(`No component_section '${sectionId}'.`);
  const [comp] = await db
    .select()
    .from(component)
    .where(eq(component.id, section.componentId))
    .limit(1);
  if (!comp) throw new Error(`No component '${section.componentId}'.`);
  return { section, component: comp };
}

/** Resolve the project id for a section (via component → stage). */
async function projectIdForSection(db: Db, componentId: string): Promise<string> {
  const [row] = await db
    .select({ projectId: stage.projectId })
    .from(component)
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(eq(component.id, componentId))
    .limit(1);
  if (!row) throw new Error(`No project for component '${componentId}'.`);
  return row.projectId;
}

/** Build the `system` prompt (stable preamble: role + component/section + gate rules). */
function buildSystem(ctx: SectionContext): string {
  const tpl = templateForKind(ctx.component.kind as ComponentKind);
  const sectionTpl = tpl.sections.find((s) => s.key === ctx.section.key);
  return [
    'You are Forge\'s spec interviewer — a precise, grounded requirements analyst.',
    `Component: ${tpl.label}. Section: ${ctx.section.label} — ${sectionTpl?.prompt ?? ''}`,
    'Ask only grounded questions that the available context cannot already answer.',
    'When the context already fully answers this section, return zero questions.',
  ].join('\n');
}

/** Build the `user` payload: intent + exploration + approved siblings + transcript. */
function buildUser(
  grounding: Grounding,
  siblings: string[],
  transcript: QaMessageRow[],
  sectionLabel: string,
): string {
  const parts: string[] = [];
  parts.push(`# Section under work: ${sectionLabel}`);
  parts.push(`\n## Intent\n${grounding.intentMd ?? '(no intent captured)'}`);
  if (grounding.explorationMd) parts.push(`\n## Exploration\n${grounding.explorationMd}`);
  if (siblings.length > 0) parts.push(`\n## Approved sibling sections\n${siblings.join('\n\n')}`);
  if (transcript.length > 0) {
    const lines = transcript.map((m) => `- ${m.sender}: ${m.bodyMd}`).join('\n');
    parts.push(`\n## Q&A transcript\n${lines}`);
  }
  return parts.join('\n');
}

/** Assemble the parse context for a call (system + user + diagnostics tags). */
async function ground(
  db: Db,
  ctx: SectionContext,
  call: string,
): Promise<{ system: string; user: string; call: string; projectId: string; section: string }> {
  const projectId = await projectIdForSection(db, ctx.section.componentId);
  const grounding = await loadGrounding(db, projectId);
  const siblings = await approvedSiblingDrafts(db, projectId);
  const transcript = await loadTranscript(db, ctx.component.id);
  return {
    system: buildSystem(ctx),
    user: buildUser(grounding, siblings, transcript, ctx.section.label),
    call,
    projectId,
    section: `${ctx.component.kind}:${ctx.section.key}`,
  };
}

/* ── Component roll-up ──────────────────────────────────────────────────── */


/* ── Core gate transitions ──────────────────────────────────────────────── */

/**
 * Shared helper — the AI gate just flipped true. (Re)drafts when no draft yet OR
 * grounding went stale; clears `stale`; advances status to `drafted` (F28: draft
 * on AI-satisfied so the human reads what they approve).
 */
async function onAiSatisfied(deps: OrchestratorDeps, ctx: SectionContext): Promise<void> {
  const db = deps.db ?? getDb();
  let draftMd = ctx.section.draftMd;
  if (draftMd == null || ctx.component.stale) {
    const groundCtx = await ground(db, ctx, 'draftSection');
    const out: DraftSection = await deps.anthropic.parse(DraftSectionSchema, groundCtx, {
      retryOnMaxTokens: true,
    });
    draftMd = out.draftMd;
  }
  await db
    .update(componentSection)
    .set({ draftMd, updatedAt: new Date() })
    .where(eq(componentSection.id, ctx.section.id));
  await db
    .update(component)
    .set({ aiSatisfied: true, stale: false, status: 'drafted', updatedAt: new Date() })
    .where(eq(component.id, ctx.section.componentId));
}

/**
 * Enter a section's loop. Stale re-draft on entry; else generate the first round
 * of questions (zero-question fast path → draft immediately).
 */
export async function enterSection(deps: OrchestratorDeps, sectionId: string): Promise<void> {
  const db = deps.db ?? getDb();
  const ctx = await loadSectionContext(db, sectionId);
  const transcript = await loadTranscript(db, sectionId);

  // Stale re-draft on entry (F1/F21): rewrite draft_md, clear stale.
  if (ctx.component.stale && transcript.length > 0 && ctx.component.aiSatisfied) {
    await onAiSatisfied(deps, ctx);
    return;
  }

  if (transcript.length > 0) return; // already in flight — nothing to do on entry

  const groundCtx = await ground(db, ctx, 'generateQuestions');
  const g: GenerateQuestions = await deps.anthropic.parse(GenerateQuestionsSchema, groundCtx);

  if (g.questions.length === 0 && g.aiSatisfiedWithoutAnswers) {
    // ZERO-QUESTION fast path → draft immediately, status 'drafted'.
    await insertForgeMessage(db, ctx.section.componentId, {
      bodyMd: g.grounding,
      meta: { round: 0, grounding: g.grounding, questions: [], assessment: { aiSatisfied: true, missingInfo: [] } },
    });
    await onAiSatisfied(deps, ctx);
  } else {
    await insertForgeMessage(db, ctx.section.componentId, {
      bodyMd: g.questions.join('\n'),
      meta: { round: 1, grounding: g.grounding, questions: g.questions, missing: [] },
    });
    await db
      .update(component)
      .set({ status: 'gathering', updatedAt: new Date() })
      .where(eq(component.id, ctx.section.componentId));
  }
}

/**
 * A member turn. Persist the answer, re-assess. On `aiSatisfied` → draft +
 * 'drafted' (chained inline, F16); else stays 'gathering' with follow-ups.
 */
export async function onMemberAnswer(
  deps: OrchestratorDeps,
  sectionId: string,
  answerMd: string,
  authorId: string,
): Promise<void> {
  const db = deps.db ?? getDb();
  const ctx = await loadSectionContext(db, sectionId);
  await insertMessageAtomic(db, {
    componentId: ctx.section.componentId,
    sender: 'member',
    bodyMd: answerMd,
    authorId,
  });
  await logAction(
    {
      projectId: await projectIdForSection(db, ctx.section.componentId),
      memberId: authorId,
      action: 'answer',
      target: `section:${ctx.section.key}`,
    },
    db,
  );

  const groundCtx = await ground(db, ctx, 'assessAnswers');
  const a: AssessAnswers = await deps.anthropic.parse(AssessAnswersSchema, groundCtx, {
    effort: 'medium',
  });

  await insertForgeMessage(db, ctx.section.componentId, {
    bodyMd: a.followUpQuestions.join('\n'),
    meta: {
      round: 'n',
      missing: a.missingInfo,
      questions: a.followUpQuestions,
      assessment: { aiSatisfied: a.aiSatisfied, missingInfo: a.missingInfo },
    },
  });

  if (a.aiSatisfied) {
    await onAiSatisfied(deps, ctx);
  } else {
    await db
      .update(component)
      .set({ aiSatisfied: false, status: 'gathering', updatedAt: new Date() })
      .where(eq(component.id, ctx.section.componentId));
  }
}

/**
 * The human nod ("Looks good"). DUAL GATE: approve iff ai_satisfied (always true
 * once 'drafted'). human_satisfied alone does NOT approve.
 */
export async function onHumanSatisfied(deps: OrchestratorDeps, sectionId: string): Promise<void> {
  const db = deps.db ?? getDb();
  const ctx = await loadSectionContext(db, sectionId);
  const nextStatus: ComponentStatus = ctx.component.aiSatisfied ? 'approved' : ctx.component.status as ComponentStatus;
  await db
    .update(component)
    .set({ humanSatisfied: true, status: nextStatus, updatedAt: new Date() })
    .where(eq(component.id, ctx.section.componentId));
}

/**
 * Force-advance — human overrides the AI. Drafts best-effort (placeholder on
 * failure, F7), sets forced + human_satisfied, advances to approved regardless of
 * ai_satisfied.
 */
export async function forceAdvance(
  deps: OrchestratorDeps,
  sectionId: string,
  authorId: string,
): Promise<void> {
  const db = deps.db ?? getDb();
  const ctx = await loadSectionContext(db, sectionId);

  let draftMd = ctx.section.draftMd;
  if (draftMd == null) {
    try {
      const groundCtx = await ground(db, ctx, 'draftSection');
      const out: DraftSection = await deps.anthropic.parse(DraftSectionSchema, groundCtx, {
        retryOnMaxTokens: true,
      });
      draftMd = out.draftMd;
    } catch {
      draftMd = FORCED_DRAFT_PLACEHOLDER; // best-effort: never leave a forced section empty (F7)
    }
  }

  await db
    .update(componentSection)
    .set({ draftMd, updatedAt: new Date() })
    .where(eq(componentSection.id, sectionId));
  await db
    .update(component)
    .set({ forced: true, humanSatisfied: true, status: 'approved', updatedAt: new Date() })
    .where(eq(component.id, ctx.section.componentId));
  await logAction(
    {
      projectId: await projectIdForSection(db, ctx.section.componentId),
      memberId: authorId,
      action: 'force_advance',
      target: `section:${ctx.section.key}`,
    },
    db,
  );
}

/**
 * The member edits the project intent before freeze (F1/F21). Re-derive summary
 * (pure), and mark every drafted/approved section `stale=true` for a lazy
 * re-draft on next entry. Approved siblings do NOT cascade-stale each other.
 */
export async function onIntentEdit(
  deps: OrchestratorDeps,
  projectId: string,
  newIntentMd: string,
): Promise<void> {
  const db = deps.db ?? getDb();
  await db
    .update(project)
    .set({ intentMd: newIntentMd, summary: deriveSummary(newIntentMd), updatedAt: new Date() })
    .where(eq(project.id, projectId));

  // Mark every drafted/approved component stale.
  const compIds = await db
    .select({ id: component.id })
    .from(component)
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(and(eq(stage.projectId, projectId), inArray(component.status, ['drafted', 'approved'])));
  const ids = compIds.map((r) => r.id);
  if (ids.length > 0) {
    await db
      .update(component)
      .set({ stale: true, updatedAt: new Date() })
      .where(inArray(component.id, ids));
  }
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Insert a qa_message with an ATOMIC seq allocation: `seq = coalesce(max,0)+1`
 * computed in the same INSERT … SELECT, so concurrent same-section writers can't
 * collide on seq (F16). The `(section_id, seq)` writes are serialized by the DB.
 */
async function insertMessageAtomic(
  db: Db,
  msg: {
    componentId: string;
    sender: 'forge' | 'member';
    bodyMd: string;
    meta?: Record<string, unknown> | null;
    authorId?: string | null;
  },
): Promise<void> {
  const metaJson = msg.meta == null ? null : JSON.stringify(msg.meta);
  await db.execute(sql`
    insert into "forge"."project_qa_message" ("component_id", "seq", "sender", "body_md", "meta", "author_id")
    select
      ${msg.componentId}::uuid,
      coalesce((select max("seq") from "forge"."project_qa_message" where "component_id" = ${msg.componentId}::uuid), 0) + 1,
      ${msg.sender},
      ${msg.bodyMd},
      ${metaJson}::jsonb,
      ${msg.authorId ?? null}::uuid
  `);
}

/** Insert a forge qa_message at the next seq (atomic). */
async function insertForgeMessage(
  db: Db,
  componentId: string,
  msg: { bodyMd: string; meta: Record<string, unknown> },
): Promise<void> {
  await insertMessageAtomic(db, { componentId, sender: 'forge', bodyMd: msg.bodyMd, meta: msg.meta });
}

/* ── Outline confirm: create components + sections ──────────────────────── */

/**
 * Create one `component` per selected kind + one `component_section` per template
 * section (status 'gathering', order_index from template order). Additive: skips
 * kinds that already exist for the stage (re-open is additive, no duplicates, F15).
 */
export async function confirmComponents(
  db: Db,
  stageId: string,
  kinds: ComponentKind[],
): Promise<void> {
  // Preserve approved components — only delete unapproved ones.
  const existing = await db
    .select({ id: component.id, kind: component.kind, status: component.status })
    .from(component)
    .where(eq(component.stageId, stageId));

  const approvedKinds = new Set(existing.filter((e) => e.status === 'approved').map((e) => e.kind));
  const toDelete = existing.filter((e) => e.status !== 'approved').map((e) => e.id);

  // Delete unapproved components (cascade deletes their sections + qa_messages)
  if (toDelete.length > 0) {
    await db.delete(component).where(inArray(component.id, toDelete));
  }
  // Delete approved components that are no longer in the selected kinds
  const approvedToRemove = existing.filter((e) => e.status === 'approved' && !kinds.includes(e.kind as ComponentKind)).map((e) => e.id);
  if (approvedToRemove.length > 0) {
    await db.delete(component).where(inArray(component.id, approvedToRemove));
  }

  // Create fresh components only for kinds that aren't already approved
  const ordered = COMPONENT_TEMPLATES.filter((t) => kinds.includes(t.kind) && !approvedKinds.has(t.kind));
  for (let i = 0; i < ordered.length; i += 1) {
    const tpl = ordered[i];
    const orderIndex = COMPONENT_TEMPLATES.findIndex((t) => t.kind === tpl.kind);
    await db.transaction(async (tx) => {
      const [comp] = await tx
        .insert(component)
        .values({
          stageId,
          kind: tpl.kind,
          primaryRoles: tpl.primaryRoles,
          status: 'gathering',
          orderIndex,
        })
        .returning({ id: component.id });
      await tx.insert(componentSection).values(
        tpl.sections.map((s, si) => ({
          componentId: comp.id,
          key: s.key,
          label: s.label,
          orderIndex: si,
        })),
      );
    });
  }
}

/** True iff every component of the stage is `approved` (assemble gate). */
export async function allComponentsApproved(db: Db, stageId: string): Promise<boolean> {
  const comps = await db
    .select({ status: component.status })
    .from(component)
    .where(eq(component.stageId, stageId));
  return comps.length > 0 && comps.every((c) => c.status === 'approved');
}

// Re-export for callers that want the status ordinal set.
