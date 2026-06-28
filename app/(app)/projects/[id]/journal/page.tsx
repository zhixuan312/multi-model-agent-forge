import { notFound, redirect } from 'next/navigation';
import { eq, and, inArray } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { mmaBatch } from '@/db/schema/mma';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { readJournalFileAsync } from '@/projects/project-files';
import { parseJournalSections } from '@/journal/journal-file-ops';
import { JournalStageClient, type JournalLearningView } from '@/components/forge/JournalStageClient';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { parseTags } from '@/journal/journal-core';
import type { LearningCategory, LearningSource } from '@/journal/types';

export default async function JournalStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ learning?: string }> }) {
  const { id } = await params;
  const { learning: activeLearningId } = await searchParams;
  const me = await currentMember();
  if (!me) redirect('/login');
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const proj = await getProject(id);
  if (!proj) notFound();

  const db = getDb();

  // Activate the journal stage on visit
  const { stage, project: projectTable } = await import('@/db/schema/projects');
  const { and: deq2, eq: deq } = await import('drizzle-orm');
  await db.update(stage).set({ status: 'active' }).where(deq2(deq(stage.projectId, id), deq(stage.kind, 'journal'), deq(stage.status, 'pending')));
  await db.update(projectTable).set({ currentStage: 'journal' }).where(eq(projectTable.id, id));

  // Check if journal.md exists (source of truth)
  const journalFile = await readJournalFileAsync(id);
  const journalMd = journalFile?.bodyMd ?? '';
  const fileSections = journalFile ? parseJournalSections(journalFile.bodyMd) : [];

  // Load DB learning candidates (metadata: status, approvals)
  const candidates = await db.select().from(learningCandidate)
    .where(eq(learningCandidate.projectId, id)).orderBy(learningCandidate.createdAt);

  const TYPE_TO_CATEGORY: Record<string, LearningCategory> = {
    decision: 'decision', insight: 'knowledge', challenge: 'process',
  };
  const ORIGIN_TO_SOURCE: Record<string, LearningSource> = {
    exploration: 'Exploration', spec: 'Spec',
  };

  // Build learnings from DB rows, with body from journal.md sections if available
  const learnings: JournalLearningView[] = candidates.map((c, i) => {
    const { category: tagCat, source: tagSrc, text } = parseTags(c.bodyMd);
    // Try to find matching section in journal.md by title
    const section = fileSections.find((s) => s.heading.replace(/^###\s*/, '').trim() === text.slice(0, 80));
    return {
      id: c.id,
      num: i + 1,
      title: text.slice(0, 80),
      body: section?.body ?? text,
      category: (tagCat ?? TYPE_TO_CATEGORY[c.type] ?? 'knowledge') as LearningCategory,
      source: (tagSrc ?? ORIGIN_TO_SOURCE[c.origin] ?? 'Manual') as LearningSource,
      status: c.status as 'proposed' | 'kept' | 'recorded',
      isManual: !!c.createdBy,
      recordedNodeId: c.recordedNodeId,
    };
  });

  const pendingHarvest = await findInflight(db, id, 'journal-harvest');
  const pendingRecord = await findInflight(db, id, 'journal-record');

  return (
    <JournalStageClient
      projectId={id}
      projectName={proj.name}
      learnings={learnings}
      journalMd={journalMd}
      hasJournalFile={!!journalFile}
      harvesting={!!pendingHarvest}
      recording={!!pendingRecord}
      activeLearningId={activeLearningId}
      currentMember={{ id: me.id, displayName: me.displayName, avatarTint: me.avatarTint }}
    />
  );
}
