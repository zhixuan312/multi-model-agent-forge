import { notFound, redirect } from 'next/navigation';
import { eq, and, inArray } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/learning';
import { mmaBatch } from '@/db/schema/ops';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { readJournalFileAsync } from '@/projects/project-files';
import { parseJournalSections } from '@/journal/journal-file-ops';
import { JournalStageClient, type JournalLearningView } from '@/components/forge/JournalStageClient';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { parseTags } from '@/journal/journal-core';
import type { LearningCategory, LearningSource } from '@/journal/types';

export default async function JournalStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ learning?: string; phase?: string }> }) {
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

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

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
  let candidates = await db.select().from(learningCandidate)
    .where(eq(learningCandidate.projectId, id)).orderBy(learningCandidate.createdAt);

  // If journal.md was deleted but DB still has candidates, clear stale rows so auto-harvest re-triggers
  if (!journalFile && candidates.length > 0) {
    await db.delete(learningCandidate).where(eq(learningCandidate.projectId, id));
    candidates = [];
  }

  // Seed DB from journal.md if file exists but no DB rows (e.g., after data cleanup)
  if (candidates.length === 0 && fileSections.length > 0) {
    const TYPE_MAP: Record<string, 'challenge' | 'insight' | 'decision'> = {
      decision: 'decision', design: 'decision', process: 'insight',
      behavior: 'insight', knowledge: 'insight', style: 'insight', challenge: 'challenge',
    };
    for (const s of fileSections) {
      const title = s.heading.replace(/^###\s*/, '').trim();
      const cat = s.category?.toLowerCase() ?? 'knowledge';
      await db.insert(learningCandidate).values({
        projectId: id,
        bodyMd: `[category:${cat}][source:${s.category ?? 'Manual'}] ${title}`,
        type: TYPE_MAP[cat] ?? 'insight',
        origin: 'spec',
        status: 'proposed',
      });
    }
    candidates = await db.select().from(learningCandidate)
      .where(eq(learningCandidate.projectId, id)).orderBy(learningCandidate.createdAt);
  }

  const TYPE_TO_CATEGORY: Record<string, LearningCategory> = {
    decision: 'decision', insight: 'knowledge', challenge: 'process',
  };
  const ORIGIN_TO_SOURCE: Record<string, LearningSource> = {
    exploration: 'Exploration', spec: 'Spec',
  };

  // Build learnings from DB rows, with body from journal.md sections if available
  const learnings: JournalLearningView[] = candidates.map((c, i) => {
    const { category: tagCat, source: tagSrc, text } = parseTags(c.bodyMd);
    // Match section in journal.md by title (starts-with for truncated DB titles)
    const section = fileSections.find((s) => {
      const heading = s.heading.replace(/^###\s*/, '').trim();
      return heading === text || heading.startsWith(text) || text.startsWith(heading);
    });
    return {
      id: c.id,
      num: i + 1,
      title: section ? section.heading.replace(/^###\s*/, '').trim() : text,
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

  const allRecorded = learnings.length > 0 && learnings.every((l) => l.status === 'recorded');
  const { loadProjectSummary } = await import('@/projects/project-summary');
  const summary = allRecorded ? await loadProjectSummary(db, id) : undefined;

  const { getLastPhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getLastPhase(db, id, 'journal') as 'journal' | 'summary' | null;
  const phaseParam = (await searchParams).learning ? undefined : (await searchParams).phase as 'journal' | 'summary' | undefined;
  const initialPhase = phaseParam ?? lastPhase ?? undefined;

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
      summary={summary}
      initialPhase={initialPhase}
      autoMode={proj.autoMode}
      autoNote={proj.autoNote ?? ''}
      readOnly={!perms.journal.canMutate}
    />
  );
}
