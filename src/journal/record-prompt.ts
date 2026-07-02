import { eq, and } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { learningCandidate } from '@/db/schema/learning';
import { parseTags } from '@/journal/journal-core';

export async function buildRecordPrompt(projectId: string, db: Db = getDb()): Promise<string> {
  const kept = await db.select({ id: learningCandidate.id, bodyMd: learningCandidate.bodyMd })
    .from(learningCandidate)
    .where(and(eq(learningCandidate.projectId, projectId), eq(learningCandidate.status, 'kept')));

  const lines = kept.map((l) => {
    const { category, source, text } = parseTags(l.bodyMd);
    return `- id=${l.id} | category=${category ?? 'insight'} | source=${source ?? 'Manual'} | ${text}`;
  });

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
