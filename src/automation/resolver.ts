import { eq, and, asc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { component } from '@/db/schema/spec';
import { auditPass } from '@/db/schema/artifacts';
import { planTask } from '@/db/schema/build';
import { learningCandidate } from '@/db/schema/learning';
import { mmaBatch } from '@/db/schema/ops';
import { readSpecFileAsync, readPlanFileAsync } from '@/projects/project-files';

export interface AutoAction {
  kind: string;
  note: string;
  data?: Record<string, unknown>;
}

const WAIT: AutoAction = { kind: 'wait', note: '' };
const COMPLETE: AutoAction = { kind: 'complete', note: 'Project complete' };

import { inArray } from 'drizzle-orm';

function isInflight(db: Db, projectId: string, handler: string) {
  return db
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(and(
      eq(mmaBatch.projectId, projectId),
      eq(mmaBatch.handler, handler),
      inArray(mmaBatch.status, ['dispatched', 'running']),
    ))
    .limit(1)
    .then((rows) => rows.length > 0);
}

export async function resolveNextAction(projectId: string, db: Db = getDb()): Promise<AutoAction> {
  const [proj] = await db
    .select({ phase: project.phase, completedAt: project.completedAt, currentStage: project.currentStage })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) return COMPLETE;
  if (proj.completedAt) return COMPLETE;

  const stages = await db
    .select({ kind: stage.kind, status: stage.status, lastPhase: stage.lastPhase })
    .from(stage)
    .where(eq(stage.projectId, projectId));
  const stageOf = (kind: string) => stages.find((s) => s.kind === kind);

  const specStage = stageOf('spec');
  const planStage = stageOf('plan');
  const executeStage = stageOf('execute');
  const reviewStage = stageOf('review');
  const journalStage = stageOf('journal');

  // ── Spec Finalize ──
  if (specStage?.status === 'active' && specStage.lastPhase === 'finalize') {
    if (await isInflight(db, projectId, 'spec-audit')) return WAIT;
    if (await isInflight(db, projectId, 'spec-audit-apply')) return WAIT;

    const specAudits = await db
      .select({ passNo: auditPass.passNo, findingsCount: auditPass.findingsCount, verdict: auditPass.verdict })
      .from(auditPass)
      .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec')))
      .orderBy(asc(auditPass.passNo));

    const latest = specAudits[specAudits.length - 1];
    if (!latest) {
      return { kind: 'dispatch_spec_audit', note: 'Running spec audit pass 1...' };
    }
    const hasCritHigh = latest.verdict === 'revised';
    if (hasCritHigh && specAudits.length < 5) {
      return { kind: 'apply_spec_findings', note: `Audit pass ${specAudits.length}/5 — applying findings...`, data: { passNo: latest.passNo } };
    }
    return { kind: 'freeze_spec', note: specAudits.length >= 5 ? 'Audit cap reached — freezing spec...' : 'Spec audit clean — freezing...' };
  }

  // ── Plan ──
  if (planStage?.status === 'active' || (specStage?.status === 'done' && planStage?.status !== 'done')) {
    const planFile = await readPlanFileAsync(projectId);
    const tasks = await db.select({ id: planTask.id, status: planTask.status }).from(planTask).where(eq(planTask.projectId, projectId));

    if (!planFile && tasks.length === 0) {
      if (await isInflight(db, projectId, 'plan-author')) return WAIT;
      const existingAuthor = await db.select({ id: mmaBatch.id }).from(mmaBatch)
        .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.handler, 'plan-author')))
        .limit(1);
      if (existingAuthor.length > 0) return WAIT;
      return { kind: 'dispatch_plan_author', note: 'Authoring plan from spec...' };
    }

    const phase = planStage?.lastPhase;
    if (phase !== 'validate') {
      const unapproved = tasks.find((t) => t.status !== 'committed');
      if (unapproved) {
        const idx = tasks.indexOf(unapproved) + 1;
        return { kind: 'approve_task', note: `Approving task ${idx}/${tasks.length}...`, data: { taskId: unapproved.id } };
      }
      return { kind: 'advance_plan_validate', note: 'All tasks approved — running audit...' };
    }

    // Validate phase — audit loop
    if (await isInflight(db, projectId, 'plan-audit')) return WAIT;
    if (await isInflight(db, projectId, 'plan-audit-apply')) return WAIT;

    const planAudits = await db
      .select({ passNo: auditPass.passNo, verdict: auditPass.verdict })
      .from(auditPass)
      .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'plan')))
      .orderBy(asc(auditPass.passNo));

    const latestPlan = planAudits[planAudits.length - 1];
    if (!latestPlan) {
      return { kind: 'dispatch_plan_audit', note: 'Running plan audit pass 1...' };
    }
    if (latestPlan.verdict === 'revised' && planAudits.length < 5) {
      return { kind: 'apply_plan_findings', note: `Plan audit pass ${planAudits.length}/5 — applying findings...`, data: { passNo: latestPlan.passNo } };
    }
    return { kind: 'lock_plan', note: 'Plan audit done — advancing to Execute...' };
  }

  // ── Execute ──
  if (executeStage?.status === 'active' || (planStage?.status === 'done' && executeStage?.status !== 'done')) {
    if (await isInflight(db, projectId, 'execute-pipeline')) return WAIT;
    const tasks = await db.select({ status: planTask.status }).from(planTask).where(eq(planTask.projectId, projectId));
    const allTerminal = tasks.length > 0 && tasks.every((t) => ['committed', 'failed', 'skipped'].includes(t.status!));
    if (!allTerminal && tasks.some((t) => ['executing', 'verifying', 'fixing'].includes(t.status!))) return WAIT;
    // Check if execution was already dispatched (any batch exists, even done)
    const existingExec = await db.select({ id: mmaBatch.id }).from(mmaBatch)
      .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.handler, 'execute-pipeline')))
      .limit(1);
    if (!allTerminal && existingExec.length > 0) return WAIT;
    if (!allTerminal && existingExec.length === 0) {
      return { kind: 'dispatch_execute', note: 'Dispatching execution...' };
    }
    const committed = tasks.filter((t) => t.status === 'committed').length;
    if (committed === 0) {
      return { kind: 'error', note: 'All tasks failed — no code committed.' };
    }
    return { kind: 'advance_to_review', note: 'Execution complete — advancing to Review...' };
  }

  // ── Review ──
  if (reviewStage?.status === 'active' || (executeStage?.status === 'done' && reviewStage?.status !== 'done')) {
    if (await isInflight(db, projectId, 'code-review')) return WAIT;
    if (await isInflight(db, projectId, 'review-apply')) return WAIT;

    const reviewAudits = await db
      .select({ passNo: auditPass.passNo, verdict: auditPass.verdict })
      .from(auditPass)
      .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'review')))
      .orderBy(asc(auditPass.passNo));

    const latestReview = reviewAudits[reviewAudits.length - 1];
    if (!latestReview) {
      return { kind: 'dispatch_review', note: 'Running code review...' };
    }
    if (latestReview.verdict === 'revised' && reviewAudits.length < 5) {
      return { kind: 'apply_review_findings', note: `Review pass ${reviewAudits.length}/5 — applying findings...`, data: { passNo: latestReview.passNo } };
    }
    return { kind: 'advance_to_journal', note: 'Review done — advancing to Journal...' };
  }

  // ── Journal ──
  if (journalStage?.status === 'active' || (reviewStage?.status === 'done' && journalStage?.status !== 'done')) {
    if (await isInflight(db, projectId, 'journal-harvest')) return WAIT;
    if (await isInflight(db, projectId, 'journal-record')) return WAIT;

    const learnings = await db
      .select({ id: learningCandidate.id, status: learningCandidate.status })
      .from(learningCandidate)
      .where(eq(learningCandidate.projectId, projectId));

    if (learnings.length === 0) {
      const existingHarvest = await db.select({ id: mmaBatch.id }).from(mmaBatch)
        .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.handler, 'journal-harvest')))
        .limit(1);
      if (existingHarvest.length > 0) return WAIT;
      return { kind: 'dispatch_harvest', note: 'Harvesting learnings...' };
    }

    const unapproved = learnings.find((l) => l.status !== 'kept' && l.status !== 'recorded');
    if (unapproved) {
      const idx = learnings.indexOf(unapproved) + 1;
      return { kind: 'approve_learning', note: `Approving learning ${idx}/${learnings.length}...`, data: { learningId: unapproved.id } };
    }

    const allRecorded = learnings.every((l) => l.status === 'recorded');
    if (!allRecorded) {
      const existingRecord = await db.select({ id: mmaBatch.id }).from(mmaBatch)
        .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.handler, 'journal-record')))
        .limit(1);
      if (existingRecord.length > 0) return WAIT;
      return { kind: 'dispatch_record', note: 'Recording learnings...' };
    }

    return { kind: 'advance_to_summary', note: 'Learnings recorded — completing project...' };
  }

  // ── Summary / Complete ──
  return { kind: 'mark_complete', note: 'Marking project complete...' };
}
