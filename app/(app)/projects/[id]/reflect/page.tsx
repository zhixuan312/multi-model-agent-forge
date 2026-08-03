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
import { parseStagePhase } from '@/projects/stage-phases';

export default async function JournalStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ learning?: string; phase?: string }> }) {
  const { id } = await params;
  const { learning: activeLearningId, phase: phaseFromUrl } = await searchParams;
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

  const { getActivePhase } = await import('@/projects/phase-tracker');
  // Read once at the top. This awaited `searchParams` twice more here and re-read
  // `.learning` even though it was already destructured above.
  //
  // Opening a specific learning PINS the journal view: `activeLearningId` is only read
  // there (the summary branch returns before it), so any other phase swallows the learning
  // the link was for. Suppressing just the URL phase — what this did — was not enough,
  // because both remaining fallbacks (the stage's active phase, and the client's derived
  // phase) land on `summary` for exactly the finished project whose learnings get linked.
  const initialPhase = activeLearningId
    ? 'journal'
    : parseStagePhase('journal', phaseFromUrl)
      ?? parseStagePhase('journal', await getActivePhase(db, id, 'journal'));

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
