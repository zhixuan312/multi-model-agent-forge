import { eq, count } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { projectJournal } from '@/db/schema/project-journal';
import { deriveDefaultProjectJournalTopic } from '@/journal/project-journal-topic';
import { validateDetails, type Details } from '@/details/schema';

type LegacyLearning = {
  heading: string;
  type: 'decision' | 'insight';
  status: 'proposed' | 'kept' | 'removed' | 'recorded';
};

export interface ProjectJournalInsertRow {
  projectId: string;
  heading: string;
  body: string;
  type: 'decision' | 'knowledge';
  topic: string;
  status: 'proposed' | 'kept' | 'removed' | 'recorded';
  seq: number;
  recordedNodeId: string | null;
  recordedAt: Date | null;
}

export function buildBackfillRows(input: {
  projectId: string;
  repos: Array<{ slug?: string | null }>;
  learnings: LegacyLearning[];
}): ProjectJournalInsertRow[] {
  const topic = deriveDefaultProjectJournalTopic(input.repos);
  return input.learnings.map((learning, seq) => {
    const type = learning.type === 'decision' ? 'decision' : 'knowledge';
    return {
      projectId: input.projectId,
      heading: learning.heading,
      body: `Legacy reflect learning migrated on 2026-07-24. Type: ${type}. Heading: ${learning.heading}. Preserve this learning during project_journal cutover.`,
      type,
      topic,
      status: learning.status,
      seq,
      recordedNodeId: null,
      recordedAt: null,
    };
  });
}

export async function backfillProjectJournalIfNeeded(input: {
  db: Db;
  projectId: string;
  details: Details | null;
}): Promise<void> {
  // Check if any rows already exist
  const existing = await input.db
    .select({ count: count() })
    .from(projectJournal)
    .where(eq(projectJournal.projectId, input.projectId));

  if ((existing[0]?.count ?? 0) > 0) {
    return; // Already backfilled — idempotent (paired with the unique (project_id, seq) index)
  }

  const d = input.details ? validateDetails(input.details) : null;
  const learnings = d?.stages.journal.phases.journal.learnings ?? [];

  if (learnings.length === 0) {
    return; // Nothing to backfill
  }

  const repos = d?.repos?.map((repo) => ({ slug: repo.name })) ?? [];
  const rows = buildBackfillRows({
    projectId: input.projectId,
    repos,
    learnings,
  });

  if (rows.length > 0) {
    await input.db.insert(projectJournal).values(rows);
  }
}
