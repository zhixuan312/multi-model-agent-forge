import { eq, and, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { qaMessage } from '@/db/schema/spec';
import { readExplorationSummary, readSpecFile, readPlanFile } from '@/projects/project-files';
import { getProject } from '@/projects/projects-core';

/**
 * The prose an MMA batch left in `output.summary` — a string as-is, an object stringified.
 * Written out three times here (execute, review, audit), so the three could disagree on
 * what to do with a non-string summary.
 */
function batchSummaryText(result: unknown): string {
  const output = ((result as Record<string, unknown> | null)?.output ?? {}) as Record<string, unknown>;
  return typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
}

/**
 * Per-section character budgets for the harvest prompt. Named because they are a PROMPT
 * BUDGET — the reason the numbers differ is that a spec deserves more room than an audit
 * summary, which is invisible when they are five bare literals down the function.
 */
const BUDGET = {
  exploration: 6_000,
  spec: 8_000,
  plan: 8_000,
  batchSummary: 4_000,
  audit: 2_000,
  message: 200,
} as const;

/** How many of the most recent discussion messages to include. */
const RECENT_MESSAGES = 50;
/** How many of the most recent audit batches to summarise. */
const RECENT_AUDITS = 3;

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
  if (explorationMd) sections.push(`## Exploration\n${explorationMd.slice(0, BUDGET.exploration)}`);

  const specFile = await readSpecFile(projectId);
  if (specFile) sections.push(`## Specification\n${specFile.bodyMd.slice(0, BUDGET.spec)}`);

  const planFile = await readPlanFile(projectId);
  if (planFile) sections.push(`## Plan\n${planFile.bodyMd.slice(0, BUDGET.plan)}`);

  const batches = await db.select({ route: mmaBatch.route, result: mmaBatch.result })
    .from(mmaBatch).where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.status, 'done'))).orderBy(desc(mmaBatch.createdAt));

  for (const [route, heading] of [['execute_plan', 'Execute Results'], ['review', 'Review Findings']] as const) {
    const batch = batches.find((b) => b.route === route);
    if (batch?.result) {
      sections.push(`## ${heading}\n${batchSummaryText(batch.result).slice(0, BUDGET.batchSummary)}`);
    }
  }

  try {
    const discussions = await db.select({ bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
        .from(qaMessage)
        .where(eq(qaMessage.projectId, projectId))
        .orderBy(qaMessage.createdAt);
    if (discussions.length > 0) {
      const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
      const convo = discussions.slice(-RECENT_MESSAGES).map((d) => {
        const role = d.authorId === FORGE_MEMBER_ID ? 'forge' : 'member';
        return `[${role}] ${(d.bodyMd ?? '').slice(0, BUDGET.message)}`;
      }).join('\n');
      sections.push(`## Conversations & Discussions\n${convo}`);
    }
  } catch { /* qa_message may not exist for all projects */ }

  const auditBatches = batches.filter((b) => b.route === 'audit').slice(0, RECENT_AUDITS);
  if (auditBatches.length > 0) {
    const auditSummaries = auditBatches
      .map((b) => batchSummaryText(b.result).slice(0, BUDGET.audit))
      .join('\n---\n');
    sections.push(`## Audit Findings\n${auditSummaries}`);
  }

  return `Role: You are the learning harvester for Forge, a software delivery harness.

Task: Analyze the project artifacts below and return structured journal staging rows for Reflect.

Input:

${sections.join('\n\n')}

Constraints:
- Return JSON with a top-level \`records\` array.
- Each record must have \`heading\`, \`body\`, and \`type\`.
- \`type\` must be one of decision, design, behavior, process, knowledge, style.
- Preserve the artifact order in the output array.
- Do not write files to disk.

Output format:
{
  "records": [
    { "heading": "string", "body": "string", "type": "decision" }
  ]
}`;
}
