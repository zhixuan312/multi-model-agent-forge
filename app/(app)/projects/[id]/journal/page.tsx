import { notFound, redirect } from 'next/navigation';
import { eq, and, inArray } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { mmaBatch } from '@/db/schema/mma';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { JournalStageClient, type JournalLearningView } from '@/components/forge/JournalStageClient';
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

  const candidates = await db.select().from(learningCandidate)
    .where(eq(learningCandidate.projectId, id)).orderBy(learningCandidate.createdAt);

  // Map DB type enum back to UI category for display
  const TYPE_TO_CATEGORY: Record<string, LearningCategory> = {
    decision: 'decision', insight: 'knowledge', challenge: 'process',
  };
  const ORIGIN_TO_SOURCE: Record<string, LearningSource> = {
    exploration: 'Exploration', spec: 'Spec',
  };

  const learnings: JournalLearningView[] = candidates.map((c, i) => {
    const { category: tagCat, source: tagSrc, text } = parseTags(c.bodyMd);
    return {
      id: c.id,
      num: i + 1,
      text,
      category: (tagCat ?? TYPE_TO_CATEGORY[c.type] ?? 'knowledge') as LearningCategory,
      source: (tagSrc ?? ORIGIN_TO_SOURCE[c.origin] ?? 'Manual') as LearningSource,
      status: c.status as 'proposed' | 'kept' | 'recorded',
      isManual: !!c.createdBy,
      recordedNodeId: c.recordedNodeId,
    };
  });

  const [harvestingBatch] = await db.select({ id: mmaBatch.id }).from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.handler, 'journal-harvest'), inArray(mmaBatch.status, ['dispatched', 'running']))).limit(1);
  const [recordingBatch] = await db.select({ id: mmaBatch.id }).from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.handler, 'journal-record'), inArray(mmaBatch.status, ['dispatched', 'running']))).limit(1);

  return (
    <JournalStageClient
      projectId={id}
      projectName={proj.name}
      phase={proj.phase as any}
      learnings={learnings}
      harvesting={!!harvestingBatch}
      recording={!!recordingBatch}
      activeLearningId={activeLearningId}
    />
  );
}
