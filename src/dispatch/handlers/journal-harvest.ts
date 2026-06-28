import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { readJournalFileAsync } from '@/projects/project-files';
import { parseJournalSections } from '@/journal/journal-file-ops';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleJournalHarvest(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  // MMA writes journal.md directly (like plan-author writes plan.md).
  // Read the file and create learning_candidate DB rows from sections.
  const existing = await db
    .select({ id: learningCandidate.id })
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, ctx.projectId))
    .limit(1);
  if (existing.length > 0) return;

  const file = await readJournalFileAsync(ctx.projectId);
  if (!file) throw new Error('journal.md not found after harvest — MMA may have failed to write it.');

  const sections = parseJournalSections(file.bodyMd);
  if (sections.length === 0) throw new Error('journal.md has no ### learning sections.');

  const TYPE_MAP: Record<string, 'challenge' | 'insight' | 'decision'> = {
    decision: 'decision', design: 'decision', process: 'insight',
    behavior: 'insight', knowledge: 'insight', style: 'insight',
    challenge: 'challenge',
  };

  for (const s of sections) {
    const title = s.heading.replace(/^###\s*/, '').trim();
    const cat = s.category?.toLowerCase() ?? 'knowledge';
    await db.insert(learningCandidate).values({
      projectId: ctx.projectId,
      bodyMd: `[category:${cat}][source:${s.category ?? 'Manual'}] ${title}`,
      type: TYPE_MAP[cat] ?? 'insight',
      origin: 'spec',
      status: 'proposed',
    });
  }
}

registerHandler('journal-harvest', handleJournalHarvest);
