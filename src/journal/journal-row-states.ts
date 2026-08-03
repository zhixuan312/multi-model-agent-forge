import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { projectJournal } from '@/db/schema/project-journal';
import type { JournalRowState } from '@/automation/details-resolver';

/**
 * The project's harvested learnings, reduced to what the resolver decides on and kept in
 * `seq` order so "approve the first proposed row" means the same thing on every tick.
 *
 * This is the one place the resolver's journal input is loaded. Both callers of
 * `allowedActions` use it — the auto driver and `performTransition` — so auto and manual
 * read exactly the same rows.
 */
export async function loadJournalRowStates(db: Db, projectId: string): Promise<JournalRowState[]> {
  const rows = await db
    .select({ id: projectJournal.id, status: projectJournal.status })
    .from(projectJournal)
    .where(eq(projectJournal.projectId, projectId))
    .orderBy(asc(projectJournal.seq));
  return rows as JournalRowState[];
}
