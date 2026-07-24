import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { projectJournal } from '@/db/schema/project-journal';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { buildJournalLearningView } from '@/journal/project-journal-view';
import { backfillProjectJournalIfNeeded } from '@/journal/project-journal-backfill';
import { JournalStageClient, type JournalLearningView } from '@/components/forge/JournalStageClient';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { validateDetails } from '@/details/schema';

export default async function JournalStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ learning?: string; phase?: string }> }) {
  const { id } = await params;
  const { learning: activeLearningId } = await searchParams;
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  if (!actor) redirect('/');
  try {
    await assertProjectReadable(id, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

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
      projectName={proj.name}
      learnings={learnings}
      journalMd=""
      hasJournalFile={false}
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
