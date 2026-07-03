import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';

export async function buildRecordPrompt(projectId: string, db: Db = getDb()): Promise<string> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return '';
  const d = validateDetails(row.details);
  const kept = d.stages.journal.phases.journal.learnings.filter((l) => l.status === 'kept');

  const lines = kept.map((l, i) => `- id=${i} | category=${l.type} | source=Forge | ${l.heading}`);

  return `Role: You are the journal recorder for Forge, a software delivery harness.

Task: Record each learning below as a separate node in the team journal at .mma/journal/.

Input:

${lines.join('\n')}

Constraints:
- Record each learning as a separate journal node
- Preserve the category and source metadata exactly as given
- Frame the title as "When [situation], [action] because [reason]" when possible
- Include Context (what happened) and Consequences (what to do differently) sections

Output format:
Write each node to .mma/journal/ using the journal_record tool.`;
}
