import { eq, and, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { qaMessage } from '@/db/schema/spec';
import { readExplorationSummary, readSpecFile, readPlanFile, journalFilePath } from '@/projects/project-files';
import { getProject } from '@/projects/projects-core';

export async function buildHarvestPrompt(projectId: string, db: Db = getDb()): Promise<string> {
  const proj = await getProject(projectId, { db });
  const sections: string[] = [];
  sections.push(`# Project: ${proj?.name ?? projectId}`);
  // Intent: in details world, brief text IS the intent
  if (proj?.details && proj.detailsReady) {
    const { getBriefText } = await import('@/details/read');
    const { validateDetails } = await import('@/details/schema');
    const brief = getBriefText(validateDetails(proj.details));
    if (brief) sections.push(`## Intent\n${brief}`);
  } else if (proj?.intentMd) {
    sections.push(`## Intent\n${proj.intentMd}`);
  }

  const explorationMd = await readExplorationSummary(projectId);
  if (explorationMd) sections.push(`## Exploration\n${explorationMd.slice(0, 6000)}`);

  const specFile = await readSpecFile(projectId);
  if (specFile) sections.push(`## Specification\n${specFile.bodyMd.slice(0, 8000)}`);

  const planFile = await readPlanFile(projectId);
  if (planFile) sections.push(`## Plan\n${planFile.bodyMd.slice(0, 8000)}`);

  const batches = await db.select({ route: mmaBatch.route, result: mmaBatch.result })
    .from(mmaBatch).where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.status, 'done'))).orderBy(desc(mmaBatch.createdAt));

  const executeBatch = batches.find((b) => b.route === 'execute_plan');
  if (executeBatch?.result) {
    const env = executeBatch.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
    sections.push(`## Execute Results\n${summary.slice(0, 4000)}`);
  }

  const reviewBatch = batches.find((b) => b.route === 'review');
  if (reviewBatch?.result) {
    const env = reviewBatch.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
    sections.push(`## Review Findings\n${summary.slice(0, 4000)}`);
  }

  try {
    const discussions = await db.select({ bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
        .from(qaMessage)
        .where(eq(qaMessage.projectId, projectId))
        .orderBy(qaMessage.createdAt);
    if (discussions.length > 0) {
      const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
      const convo = discussions.slice(-50).map((d) => {
        const role = d.authorId === FORGE_MEMBER_ID ? 'forge' : 'member';
        return `[${role}] ${(d.bodyMd ?? '').slice(0, 200)}`;
      }).join('\n');
      sections.push(`## Conversations & Discussions\n${convo}`);
    }
  } catch { /* qa_message may not exist for all projects */ }

  const auditBatches = batches.filter((b) => b.route === 'audit').slice(0, 3);
  if (auditBatches.length > 0) {
    const auditSummaries = auditBatches.map((b) => {
      const env = b.result as Record<string, unknown>;
      const output = (env?.output ?? {}) as Record<string, unknown>;
      const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
      return summary.slice(0, 2000);
    }).join('\n---\n');
    sections.push(`## Audit Findings\n${auditSummaries}`);
  }

  // MUST await: journalFilePath is async. Unawaited, the Promise interpolated into the prompt
  // below renders as "[object Promise]", so the harvester is told to write to a bogus path.
  const journalPath = await journalFilePath(projectId, db);

  return `Role: You are the learning harvester for Forge, a software delivery harness.

Task: Analyze the project artifacts below and extract 10-20 learnings. Write them to \`${journalPath}\`.

Input:

${sections.join('\n\n')}

Constraints:
- Extract learnings in TWO tiers: domain-specific and generic
- Cover ALL 6 categories: Decision, Design, Behavior, Process, Knowledge, Style
- Each learning: "When [situation], [action] because [reason]"
- Include Principle, Evidence, Risk if ignored, Confidence, Tier, Source, Tags
- Group under ## category headings, ### for each learning
Write the file to \`${journalPath}\`.`;
}
