import type { Db } from '@/db/client';
import { readJournalFile } from '@/projects/project-files';
import { parseJournalSections } from '@/journal/journal-file-ops';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';

async function handleJournalHarvest(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  const file = await readJournalFile(ctx.projectId);
  if (!file) throw new Error('journal.md not found after harvest — MMA may have failed to write it.');

  const sections = parseJournalSections(file.bodyMd);
  if (sections.length === 0) throw new Error('journal.md has no ### learning sections.');

  await updateDetails(db, ctx.projectId, (d) => {
    if (d.stages.journal.phases.journal.learnings.length > 0) return d;
    for (const s of sections) {
      const title = s.heading.replace(/^###\s*/, '').trim();
      const cat = s.category?.toLowerCase() ?? 'knowledge';
      d.stages.journal.phases.journal.learnings.push({
        heading: title,
        type: (cat === 'decision' || cat === 'design') ? 'decision' : 'insight',
        status: 'proposed',
      });
    }
    return d;
  });
}

registerHandler('journal-harvest', handleJournalHarvest);
