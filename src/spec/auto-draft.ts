import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import type { ComponentKind } from '@/db/enums';
import { teamSpecTemplate } from '@/db/schema/team';
import { templateForKind } from '@/spec/components';
import { readExplorationSummary } from '@/projects/project-files';

export interface SpecAuthoringRequest {
  target: { inline: string };
  outputPath: string;
}

export async function buildSpecAuthoringRequest(
  deps: { db?: Db; projectId: string; outputPath: string },
): Promise<SpecAuthoringRequest | { error: string }> {
  const db = deps.db ?? getDb();
  const [projRow] = await db
    .select({ details: project.details, intentMd: project.intentMd })
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
  const selectedLabels = components.flatMap((component) => {
    const tpl = templateById.get(component.templateId);
    if (!tpl) return [];
    return [templateForKind(tpl.kind as ComponentKind).label];
  });
  if (selectedLabels.length === 0) return { error: 'No sections to draft.' };

  const inline = [
    '# Captured intent',
    '',
    intentMd,
    '',
    '# Exploration summary',
    '',
    explorationMd || '_No exploration summary was found._',
    '',
    '# Selected components',
    '',
    ...selectedLabels.map((label) => `- ${label}`),
    '',
    '# Output path',
    '',
    deps.outputPath,
  ].join('\n');

  return {
    target: { inline },
    outputPath: deps.outputPath,
  };
}
