import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
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

  const { getBriefText } = await import('@/details/read');
  const { validateDetails } = await import('@/details/schema');
  let intentText: string | null = null;
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, deps.projectId)).limit(1);
  if (projRow?.details) intentText = getBriefText(validateDetails(projRow.details)) || null;
  const exploration = await getLatestExploration(deps.projectId);

  // Read components from details + sections from team_spec_template
  const d = projRow?.details ? validateDetails(projRow.details) : null;
  if (!d) return { error: 'No details.' };

  const { teamSpecTemplate } = await import('@/db/schema/team');
  const templates = await db.select().from(teamSpecTemplate);
  const templateByKind = new Map(templates.map((t) => [t.kind, t]));

  const comps = d.stages.spec.phases.craft.components.filter((c) => c.approvals.length === 0);
  if (comps.length === 0) return { error: 'No sections to draft.' };

  const outline: OutlineEntry[] = [];
  for (const comp of comps) {
    const tpl = templateByKind.get(comp.templateId.split('-')[1] ?? '');
    const compTpl = tpl ? templateForKind(tpl.kind as ComponentKind) : null;
    if (!compTpl || !tpl) continue;
    const secs = (tpl.sections as Array<{ key: string; label: string }>) ?? [];
    for (const sec of secs) {
      const secTpl = compTpl.sections.find((t) => t.key === sec.key);
      outline.push({
        componentKind: tpl.kind,
        componentLabel: compTpl.label,
        sectionKey: sec.key,
        sectionLabel: sec.label,
        prompt: secTpl?.prompt ?? sec.label,
        roles: compTpl.primaryRoles,
        sectionId: `${comp.templateId}:${sec.key}`,
        componentId: comp.templateId,
      });
    }
  }

  if (outline.length === 0) return { error: 'No sections to draft.' };

  return {
    system: buildFullDraftSystem(),
    user: buildFullDraftUser(intentText, exploration?.bodyMd ?? null, outline),
    outline,
  };
}


