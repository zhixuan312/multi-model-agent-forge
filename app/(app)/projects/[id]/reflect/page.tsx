import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { projectJournal } from '@/db/schema/project-journal';
import { getProject } from '@/projects/projects-core';
import { requireProjectAccess } from '@/projects/require-project-access';
import { buildJournalLearningView } from '@/journal/project-journal-view';
import { backfillProjectJournalIfNeeded } from '@/journal/project-journal-backfill';
import { JournalStageClient } from '@/components/forge/JournalStageClient';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { validateDetails } from '@/details/schema';

export default async function JournalStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ learning?: string; phase?: string }> }) {
  const { id } = await params;
  const { learning: activeLearningId } = await searchParams;
  await requireProjectAccess(id);

  const proj = await getProject(id);
  if (!proj) notFound();

  const db = getDb();

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  // Backfill from legacy details if needed
  const projDetails = proj.details ? validateDetails(proj.details) : null;
  await backfillProjectJournalIfNeeded({ db, projectId: id, details: projDetails });

  // Load learnings from project_journal table
  const rows = await db
    .select()
    .from(projectJournal)
    .where(eq(projectJournal.projectId, id))
    .orderBy(asc(projectJournal.seq));
  const learnings = buildJournalLearningView(rows);
  const pendingHarvest = await findInflight(db, id, 'journal-harvest');
  const pendingRecord = await findInflight(db, id, 'journal-record');
  const allRecorded = rows.length > 0 && rows.every((row) => row.status === 'recorded' || row.status === 'removed');
  const { loadProjectSummary } = await import('@/projects/project-summary');
  const summary = allRecorded ? await loadProjectSummary(db, id) : undefined;

  const { getLastPhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getLastPhase(db, id, 'journal') as 'journal' | 'summary' | null;
  const phaseParam = (await searchParams).learning ? undefined : (await searchParams).phase as 'journal' | 'summary' | undefined;
  const initialPhase = phaseParam ?? lastPhase ?? undefined;

  return (
    <JournalStageClient
      projectId={id}
      learnings={learnings}
      harvesting={!!pendingHarvest}
      recording={!!pendingRecord}
      activeLearningId={activeLearningId}
      summary={summary}
      initialPhase={initialPhase}
      readOnly={!perms.journal.canMutate}
      lockedReason={perms.journal.reason}
    />
  );
}
