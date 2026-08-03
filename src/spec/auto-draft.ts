import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import type { ComponentKind } from '@/db/enums';
import { teamSpecTemplate } from '@/db/schema/team';
import { templateForKind } from '@/spec/components';
import { readExplorationSummary } from '@/projects/project-files';

export interface SpecAuthoringRequest {
  prompt: string;
  /** Exploration.md is passed by PATH (symmetric to plan → spec.md); the inline
   * arm is the fallback when no exploration file exists. */
  target: { paths: string[] } | { inline: string };
  outputPath: string;
  /** Canonical component labels to emit — mma-spec (>=5.8.7) drafts only these
   * (the subset). Empty is never sent; omitting the field would default to all 8. */
  components: string[];
}

export async function buildSpecAuthoringRequest(
  deps: { db?: Db; projectId: string; outputPath: string; explorationPath: string },
): Promise<SpecAuthoringRequest | { error: string }> {
  const db = deps.db ?? getDb();
  const [projRow] = await db
    .select({ name: project.name, details: project.details, intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, deps.projectId))
    .limit(1);

  const { validateDetails } = await import('@/details/schema');
  const details = projRow?.details ? validateDetails(projRow.details) : null;
  if (!details) return { error: 'No details.' };

  const intentMd = projRow?.intentMd?.trim() ?? '';
  if (!intentMd) return { error: 'Spec drafting requires captured intent.' };

  const explorationMd = (await readExplorationSummary(deps.projectId))?.trim() ?? '';
  const components = details.stages.spec.phases.craft.components.filter((c) => c.approvals.length === 0);
  if (components.length === 0) return { error: 'No sections to draft.' };

  const templates = await db.select().from(teamSpecTemplate);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  // A component whose template row is gone must NOT be quietly left out of the request:
  // MMA would then never draft it and the user would wait for a section that cannot
  // arrive. The all-missing case was already refused; a PARTIAL miss slipped through.
  const orphaned = components.filter((c) => !templateById.has(c.templateId));
  if (orphaned.length > 0) {
    return { error: `Spec templates are missing for ${orphaned.length} selected component(s) — run \`pnpm db:seed-templates\`.` };
  }
  const selectedLabels = components.map(
    (component) => templateForKind(templateById.get(component.templateId)!.kind as ComponentKind).label,
  );
  if (selectedLabels.length === 0) return { error: 'No sections to draft.' };

  // Intent (DB-sourced, never a file) rides in the prompt alongside the feature
  // title. Exploration.md — the grounding artifact — is passed by PATH so the
  // worker reads the live file (symmetric to plan passing spec.md). If no
  // exploration exists (rare edge: the "Continue to Spec" gate sets the details
  // flag, but the on-disk file was removed), fall back to an inline note so the
  // required target arm is still present.
  const prompt = [
    projRow?.name?.trim() || 'Project specification',
    '',
    '# Captured intent',
    '',
    intentMd,
  ].join('\n');

  const target = explorationMd
    ? { paths: [deps.explorationPath] }
    : { inline: '# Exploration summary\n\n_No exploration summary was found._' };

  // The selected component labels are passed as the structured `components` field
  // (mma-spec >=5.8.7 subset support), NOT as prose — the engine injects the
  // canonical `## Requested Spec Components` block from it. Labels are the 8
  // canonical SPEC_COMPONENTS values (templateForKind(kind).label), so the
  // engine's `z.enum(SPEC_COMPONENTS)` accepts them.
  return {
    prompt,
    target,
    outputPath: deps.outputPath,
    components: selectedLabels,
  };
}
