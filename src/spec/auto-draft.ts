import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { component, componentSection } from '@/db/schema/spec';
import type { ComponentKind } from '@/db/enums';
import { templateForKind } from '@/spec/components';
import { getLatestExploration } from '@/spec/orchestrator';

/**
 * Auto-draft — ONE main-agent call drafts ALL spec sections +
 * attaches 0-N questions per section. Sections with 0 questions are AI-satisfied.
 */

/* ── Full-spec draft (one call) ──────────────────────────────────────────── */

function buildFullDraftSystem(): string {
  return `Role: You are a specification drafter for Forge, a collaborative SDLC platform.

Task: Draft EVERY section of the spec outline and attach follow-up questions where the exploration brief leaves gaps. Each section should be a complete, audience-appropriate draft ready for team review.

Constraints:
- Do NOT add the component heading (e.g. ## Context) — it is added automatically. Use ### subheadings within the section freely
- Stay strictly within each section's stated scope — never duplicate content from sibling sections
- Attach 0-N questions per section: ask when the exploration brief leaves genuine gaps. Ask ALL questions at once
- Ground your draft in the exploration findings, but adapt language to the audience
- Write in proper markdown: use ### subheadings, **bold** for key terms, bullet lists for requirements/criteria, \`code\` for technical names, tables for comparisons, > blockquotes for callouts. The output renders as a professional document, not a wall of text
- Audience rules per section (listed in the outline):
  - BO / PM: Plain business language. NO code references, file paths, or engineering jargon. Describe WHAT and WHY, not HOW
  - SWE: Technical detail expected. Name files, functions, libraries, patterns
  - Mixed roles: Lead with business context, then add a technical details subsection

Output format:
Return a JSON object with this EXACT structure:
\`\`\`json
{
  "sections": [
    {
      "componentKind": "<the component kind>",
      "sectionKey": "<the section key>",
      "draftMd": "<your drafted markdown content for this section>",
      "questions": ["question 1", "question 2"]
    }
  ]
}
\`\`\`
- Return ALL sections in the spec outline, in order
- The content field MUST be named "draftMd"
- If the brief fully covers a section, return an empty questions array`;
}

function buildFullDraftUser(
  intentMd: string | null,
  explorationMd: string | null,
  outline: { componentKind: string; componentLabel: string; sectionKey: string; sectionLabel: string; prompt: string; roles: string[] }[],
): string {
  const parts: string[] = [];
  parts.push(`Context:\n\n# Project intent\n${intentMd ?? '(no intent captured)'}`);
  if (explorationMd) parts.push(`\n# Exploration brief\n${explorationMd}`);
  parts.push('\nInput: Spec outline — draft each section below');
  for (const s of outline) {
    parts.push(`\n## ${s.componentLabel} > ${s.sectionLabel}`);
    parts.push(`componentKind: ${s.componentKind}`);
    parts.push(`sectionKey: ${s.sectionKey}`);
    parts.push(`Audience: ${s.roles.join(', ') || 'SWE'}`);
    parts.push(`Prompt: ${s.prompt}`);
  }
  return parts.join('\n');
}

export interface OutlineEntry {
  componentKind: string;
  componentLabel: string;
  sectionKey: string;
  sectionLabel: string;
  prompt: string;
  roles: string[];
  sectionId: string;
  componentId: string;
}

export interface AutoDraftRequest {
  system: string;
  user: string;
  outline: OutlineEntry[];
}

export async function buildAutoDraftRequest(
  deps: { db?: Db; projectId: string },
): Promise<AutoDraftRequest | { error: string }> {
  const db = deps.db ?? getDb();

  const [proj] = await db
    .select({ intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, deps.projectId))
    .limit(1);
  const exploration = await getLatestExploration(deps.projectId);

  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, deps.projectId), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) return { error: 'No spec stage.' };

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
      orderIndex: componentSection.orderIndex,
    })
    .from(componentSection)
    .innerJoin(component, eq(componentSection.componentId, component.id))
    .where(and(eq(component.stageId, specStage.id), sql`${component.status} != 'approved'`))
    .orderBy(component.orderIndex, componentSection.orderIndex);

  if (sections.length === 0) return { error: 'No sections to draft.' };

  const compById = new Map(components.map((c) => [c.id, c]));
  const outline: OutlineEntry[] = sections.map((s) => {
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

  return {
    system: buildFullDraftSystem(),
    user: buildFullDraftUser(proj?.intentMd ?? null, exploration?.bodyMd ?? null, outline),
    outline,
  };
}


