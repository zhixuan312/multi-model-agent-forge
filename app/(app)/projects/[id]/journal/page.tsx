import { notFound, redirect } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { JournalStageClient } from '@/components/forge/JournalStageClient';
import type { Learning, LearningCategory, LearningSource } from '@/mock/domains/projects/journal';

export default async function JournalStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  // Load existing learning candidates from DB
  const candidates = await db
    .select()
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, id))
    .orderBy(learningCandidate.createdAt);

  const learnings: Learning[] = candidates.map((c, i) => ({
    id: c.id,
    num: i + 1,
    text: c.bodyMd,
    tags: [],
    source: (c.origin ?? 'Manual') as LearningSource,
    category: (c.type ?? 'knowledge') as LearningCategory,
  }));

  return (
    <JournalStageClient
      projectId={id}
      projectName={proj.name}
      phase={proj.phase as any}
      learnings={learnings}
    />
  );
}
