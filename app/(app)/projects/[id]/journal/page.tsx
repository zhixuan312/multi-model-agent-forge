import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { USE_MOCK } from '@/mock/config';
import { mockJournal } from '@/mock/domains/projects/journal';
import { JournalStageClient } from '@/components/forge/JournalStageClient';

/**
 * Journal stage (LEARN group) — the lifecycle's final stop: Harvest → Curate →
 * Record. Learnings from the whole run are recorded to the journal (MMA
 * journal-record in the real product). Automated mode can close the loop on its
 * own; the human can curate which learnings to keep.
 */
export default async function JournalStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  if (USE_MOCK) {
    const m = mockJournal(id);
    return <JournalStageClient projectId={id} projectName={m.projectName} phase="build" learnings={m.learnings} />;
  }

  // Real backend wiring lands later.
  notFound();
}
