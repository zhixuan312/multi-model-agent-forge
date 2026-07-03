import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { readJournalFileAsync } from '@/projects/project-files';
import { parseJournalSections } from '@/journal/journal-file-ops';
import { JournalStageClient, type JournalLearningView } from '@/components/forge/JournalStageClient';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
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

  // Activate the journal stage on visit via details
  await updateDetails(db, id, (d) => {
    if (d.stages.journal.status === 'pending') {
      d.stages.journal.status = 'active';
      d.stages.journal.startedAt = new Date().toISOString();
    }
    return d;
  });
  await db.update(project).set({ currentStage: 'journal' }).where(eq(project.id, id));

  // Check if journal.md exists (source of truth for content)
  const journalFile = await readJournalFileAsync(id);
  const journalMd = journalFile?.bodyMd ?? '';
  const fileSections = journalFile ? parseJournalSections(journalFile.bodyMd) : [];

  // Load learnings from details
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  const d = projRow?.details ? validateDetails(projRow.details) : null;
  let detailsLearnings = d?.stages.journal.phases.journal.learnings ?? [];

  // If journal.md was deleted but details still has learnings, clear them
  if (!journalFile && detailsLearnings.length > 0) {
    await updateDetails(db, id, (det) => {
      det.stages.journal.phases.journal.learnings = [];
      return det;
    });
    detailsLearnings = [];
  }

  // Seed details from journal.md if file exists but no details learnings
  if (detailsLearnings.length === 0 && fileSections.length > 0) {
    const TYPE_MAP: Record<string, 'decision' | 'insight'> = {
      decision: 'decision', design: 'decision', process: 'insight',
      behavior: 'insight', knowledge: 'insight', style: 'insight', challenge: 'insight',
    };
    await updateDetails(db, id, (det) => {
      det.stages.journal.phases.journal.learnings = fileSections.map((s) => {
        const title = s.heading.replace(/^###\s*/, '').trim();
        const cat = s.category?.toLowerCase() ?? 'knowledge';
        return {
          heading: title,
          type: TYPE_MAP[cat] ?? 'insight',
          status: 'proposed' as const,
        };
      });
      return det;
    });
    // Re-read after seed
    const [reRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
    detailsLearnings = reRow?.details ? validateDetails(reRow.details).stages.journal.phases.journal.learnings : [];
  }

  const TYPE_TO_CATEGORY: Record<string, LearningCategory> = {
    decision: 'decision', insight: 'knowledge',
  };

  // Build learnings view from details, with body from journal.md sections
  const learnings: JournalLearningView[] = detailsLearnings.map((l, i) => {
    const section = fileSections.find((s) => {
      const heading = s.heading.replace(/^###\s*/, '').trim();
      return heading === l.heading || heading.startsWith(l.heading) || l.heading.startsWith(heading);
    });
    return {
      id: `learning-${i}`,
      num: i + 1,
      title: l.heading,
      body: section?.body ?? l.heading,
      category: (TYPE_TO_CATEGORY[l.type] ?? 'knowledge') as LearningCategory,
      source: (section?.category ?? 'Manual') as LearningSource,
      status: l.status as 'proposed' | 'kept' | 'recorded',
      isManual: false,
      recordedNodeId: null,
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
