import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { readJournalFile } from '@/projects/project-files';
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

  // Project members for discussion attribution — same load as the spec / plan pages.
  const { member } = await import('@/db/schema/identity');
  const allMembers = await db
    .select({ id: member.id, displayName: member.displayName, avatarTint: member.avatarTint })
    .from(member);
  const projectMembers = allMembers
    .filter((m) => m.id !== me.id)
    .map((m) => ({ id: m.id, displayName: m.displayName, avatarTint: m.avatarTint }));

  // READ-ONLY w.r.t. stage progression — do NOT activate the journal stage or write
  // current_stage on visit (that races/corrupts an in-flight run). Stage progression
  // is owned by the auto-driver and the /advance route. The learnings file↔details
  // sync below is journal-content only (guarded so it no-ops during a healthy run).
  // Check if journal.md exists (source of truth for content)
  const journalFile = await readJournalFile(id);
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
      projectMembers={projectMembers}
      summary={summary}
      initialPhase={initialPhase}
      autoMode={proj.autoMode}
      autoNote={proj.autoNote ?? ''}
      readOnly={!perms.journal.canMutate}
    />
  );
}
