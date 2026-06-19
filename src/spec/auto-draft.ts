import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { artifact } from '@/db/schema/artifacts';
import { component, componentSection } from '@/db/schema/spec';
import type { ComponentKind } from '@/db/enums';
import { AnthropicClient, type CallUsage } from '@/anthropic/client';
import { DraftSectionSchema, type DraftSection } from '@/spec/schemas';
import { templateForKind } from '@/spec/components';
import { recomputeComponentStatus, getLatestExploration } from '@/spec/orchestrator';
import { recordOrchestratorUsage } from '@/usage/record-orchestrator';
import { logPoll } from '@/observability/poll-log';

/**
 * Auto-draft (Approach C) — draft all gathering sections in one pass using
 * the exploration brief as context, skipping the Q&A loop. Each section gets
 * a direct DraftSection call grounded in intent + exploration. Sections that
 * are already drafted/approved are skipped. Failures are isolated per-section.
 */

export interface AutoDraftDeps {
  db?: Db;
  anthropic: Pick<AnthropicClient, 'parse' | 'parseWithUsage'>;
  sectionId?: string;
  projectId?: string;
}

interface Grounding {
  intentMd: string | null;
  explorationMd: string | null;
}

async function loadGrounding(db: Db, projectId: string): Promise<Grounding> {
  const [proj] = await db
    .select({ intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  const exploration = await getLatestExploration(db, projectId);
  return { intentMd: proj?.intentMd ?? null, explorationMd: exploration?.bodyMd ?? null };
}

async function approvedSiblingDrafts(db: Db, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ label: componentSection.label, draftMd: componentSection.draftMd })
    .from(componentSection)
    .innerJoin(component, eq(componentSection.componentId, component.id))
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(
      and(
        eq(stage.projectId, projectId),
        eq(componentSection.status, 'approved'),
        sql`${componentSection.draftMd} is not null`,
      ),
    );
  return rows.filter((r) => r.draftMd).map((r) => `### ${r.label}\n${r.draftMd}`);
}

function buildAutoDraftSystem(kind: ComponentKind, sectionKey: string, sectionLabel: string): string {
  const tpl = templateForKind(kind);
  const sectionTpl = tpl.sections.find((s) => s.key === sectionKey);
  return [
    'You are Forge\'s spec drafter. Draft the content for ONE section of a specification document.',
    `Component: ${tpl.label}. Section: ${sectionLabel} — ${sectionTpl?.prompt ?? ''}`,
    'Use the exploration brief and project intent as your primary source. Be specific and grounded.',
    'Write in clear, professional markdown. Do not add a heading — the section heading is added automatically.',
  ].join('\n');
}

function buildAutoDraftUser(grounding: Grounding, siblings: string[], sectionLabel: string): string {
  const parts: string[] = [];
  parts.push(`# Section to draft: ${sectionLabel}`);
  parts.push(`\n## Project intent\n${grounding.intentMd ?? '(no intent captured)'}`);
  if (grounding.explorationMd) parts.push(`\n## Exploration brief\n${grounding.explorationMd}`);
  if (siblings.length > 0) parts.push(`\n## Already-drafted sibling sections\n${siblings.join('\n\n')}`);
  return parts.join('\n');
}

/**
 * Auto-draft a single section. Skips if already drafted/approved.
 * Sets ai_satisfied=true and status='drafted' on success.
 */
export async function autoDraftSection(deps: AutoDraftDeps & { sectionId: string }): Promise<{ drafted: boolean }> {
  const db = deps.db ?? getDb();

  const [section] = await db
    .select()
    .from(componentSection)
    .where(eq(componentSection.id, deps.sectionId))
    .limit(1);
  if (!section) return { drafted: false };
  if (section.status === 'drafted' || section.status === 'approved') return { drafted: false };

  const [comp] = await db
    .select()
    .from(component)
    .where(eq(component.id, section.componentId))
    .limit(1);
  if (!comp) return { drafted: false };

  const [stageRow] = await db
    .select({ projectId: stage.projectId })
    .from(component)
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(eq(component.id, section.componentId))
    .limit(1);
  if (!stageRow) return { drafted: false };

  const grounding = await loadGrounding(db, stageRow.projectId);
  const siblings = await approvedSiblingDrafts(db, stageRow.projectId);

  const system = buildAutoDraftSystem(comp.kind as ComponentKind, section.key, section.label);
  const user = buildAutoDraftUser(grounding, siblings, section.label);

  const result = await deps.anthropic.parseWithUsage(DraftSectionSchema, {
    system,
    user,
    call: 'autoDraftSection',
    projectId: stageRow.projectId,
    section: `${comp.kind}:${section.key}`,
  });

  await db
    .update(componentSection)
    .set({
      draftMd: result.data.draftMd,
      aiSatisfied: true,
      status: 'drafted',
      stale: false,
      updatedAt: new Date(),
    })
    .where(eq(componentSection.id, deps.sectionId));

  await recomputeComponentStatus(db, section.componentId);
  await recordOrchestratorUsage(stageRow.projectId, 'autoDraftSection', result.usage, { db }).catch(() => {});

  return { drafted: true };
}

export interface AutoDraftAllResult {
  total: number;
  drafted: number;
  failed: number;
  errors: { sectionId: string; error: string }[];
}

/**
 * Auto-draft all gathering sections for a project's spec stage.
 * Fires one LLM call per section. Failures are isolated — one section
 * failing doesn't block the others.
 */
export async function autoDraftAll(deps: AutoDraftDeps & { projectId: string }): Promise<AutoDraftAllResult> {
  const db = deps.db ?? getDb();

  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, deps.projectId), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) return { total: 0, drafted: 0, failed: 0, errors: [] };

  const sections = await db
    .select({ id: componentSection.id, status: componentSection.status })
    .from(componentSection)
    .innerJoin(component, eq(componentSection.componentId, component.id))
    .where(and(eq(component.stageId, specStage.id), eq(componentSection.status, 'gathering')));

  const result: AutoDraftAllResult = { total: sections.length, drafted: 0, failed: 0, errors: [] };

  for (const section of sections) {
    try {
      const { drafted } = await autoDraftSection({ ...deps, sectionId: section.id });
      if (drafted) result.drafted++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ sectionId: section.id, error: message });
      logPoll({ level: 'error', event: 'auto_draft.failure', detail: `${section.id}: ${message}` });
    }
  }

  return result;
}
