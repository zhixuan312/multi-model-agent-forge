import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { readMmaBearer } from '@/mma/client-config';
import { loadPlanView } from '@/plan/plan-core';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { isVoiceEnabled } from '@/config/connections-core';
import { PlanStageClient } from '@/components/forge/PlanStageClient';

export default async function PlanStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ phase?: string }> }) {
  const { id } = await params;
  const { phase: phaseParam } = await searchParams;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();

  const validPlanPhases = ['refine', 'validate'] as const;
  type PlanPhase = typeof validPlanPhases[number];
  const { getLastPhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getLastPhase(db, id, 'plan') as PlanPhase | null;
  const initialPhase: PlanPhase | undefined = validPlanPhases.includes(phaseParam as any)
    ? (phaseParam as PlanPhase)
    : lastPhase ?? undefined;
  const [proj] = await db
    .select({ name: project.name, intentMd: project.intentMd, phase: project.phase })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  // Activate the plan stage + update current_stage on visit
  const { stage } = await import('@/db/schema/projects');
  const { and, eq: deq } = await import('drizzle-orm');
  await db.update(stage).set({ status: 'active' }).where(and(deq(stage.projectId, id), deq(stage.kind, 'plan'), deq(stage.status, 'pending')));
  await db.update(project).set({ currentStage: 'plan' }).where(eq(project.id, id));

  const planView = await loadPlanView(db, id);
  const mmaReady = readMmaBearer() !== null;
  const voiceEnabled = await isVoiceEnabled({ db });
  const pendingAuthor = await findInflight(db, id, 'plan-author');
  const pendingAudit = await findInflight(db, id, 'plan-audit');
  const pendingApply = await findInflight(db, id, 'plan-audit-apply');

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  return (
    <PlanStageClient
      projectId={id}
      projectName={proj.name}
      intentMd={proj.intentMd ?? ''}
      phase={proj.phase}
      mmaReady={mmaReady}
      phases={planView.phases}
      planMd={planView.planMd ?? ''}
      auditRounds={planView.auditHistory.map((h) => h.findings.map((f) => ({
        severity: f.severity,
        category: f.category,
        claim: f.claim,
        evidence: f.evidence,
        suggestion: f.suggestion,
      })))}
      auditApplied={planView.auditHistory.map((h) => h.applied)}
      voiceEnabled={voiceEnabled}
      pendingAuthor={pendingAuthor}
      pendingAudit={pendingAudit}
      pendingApply={pendingApply}
      initialPhase={initialPhase}
    />
  );
}
