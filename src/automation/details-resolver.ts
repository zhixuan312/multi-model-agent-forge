import type { Details } from '@/details/schema';

export interface AutoAction {
  kind: string;
  note: string;
  stage: string;
  phase: string;
  data?: Record<string, unknown>;
}

const WAIT: AutoAction = { kind: 'wait', note: '', stage: '', phase: '' };
const COMPLETE: AutoAction = { kind: 'complete', note: 'Project complete', stage: '', phase: '' };

export function resolveNextActionFromDetails(details: Details): AutoAction {
  const spec = details.stages.spec;
  const plan = details.stages.plan;
  const execute = details.stages.execute;
  const review = details.stages.review;
  const journal = details.stages.journal;

  // Spec Finalize — audit loop
  if (spec.status === 'active' && spec.phases.finalize.status === 'active') {
    const passes = spec.phases.finalize.auditPasses;
    const lastPass = passes[passes.length - 1];
    const latestAttempt = lastPass?.audit?.attempts?.[lastPass.audit.attempts.length - 1];

    if (latestAttempt?.status === 'running') return WAIT;
    if (lastPass?.fix?.attempts) {
      const fixAttempt = lastPass.fix.attempts[lastPass.fix.attempts.length - 1];
      if (fixAttempt?.status === 'running') return WAIT;
    }

    if (!lastPass) {
      return { kind: 'dispatch_audit', note: 'Running spec audit pass 1...', stage: 'spec', phase: 'finalize' };
    }
    if (lastPass.status === 'revised') {
      if (!lastPass.fix || lastPass.fix.attempts.length === 0) {
        return { kind: 'apply_findings', note: `Applying spec audit pass ${passes.length} findings...`, stage: 'spec', phase: 'finalize', data: { passNo: lastPass.passNo } };
      }
      if (passes.length < 5) {
        return { kind: 'dispatch_audit', note: `Running spec audit pass ${passes.length + 1}...`, stage: 'spec', phase: 'finalize' };
      }
    }
    return { kind: 'approve_stage', note: 'Spec audit done — approving spec...', stage: 'spec', phase: 'finalize' };
  }

  // Plan Refine — author + validate + approve tasks
  if (plan.status === 'active' && plan.phases.refine.status === 'active') {
    if (!plan.phases.refine.file) {
      const authorAttempts = plan.phases.refine.attempts;
      const last = authorAttempts[authorAttempts.length - 1];
      if (last?.status === 'running') return WAIT;
      if (!last || last.status === 'failed') {
        return { kind: 'dispatch_plan_author', note: 'Authoring plan from spec...', stage: 'plan', phase: 'refine' };
      }
      return WAIT;
    }

    const tasks = plan.phases.refine.tasks;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.approvals.length > 0) continue;

      const lastAttempt = t.attempts[t.attempts.length - 1];
      if (lastAttempt?.status === 'running') return WAIT;
      if (!lastAttempt || lastAttempt.status === 'failed') {
        return { kind: 'validate_task', note: `Validating task ${i + 1}/${tasks.length}: ${t.title}`, stage: 'plan', phase: 'refine', data: { taskId: t.id, taskTitle: t.title, taskNum: i + 1, totalTasks: tasks.length } };
      }
      return { kind: 'approve_task', note: `Approving task ${i + 1}/${tasks.length}: ${t.title}`, stage: 'plan', phase: 'refine', data: { taskId: t.id } };
    }

    return { kind: 'advance_phase', note: 'All tasks approved — running plan audit...', stage: 'plan', phase: 'validate' };
  }

  // Plan Validate — audit loop
  if (plan.status === 'active' && plan.phases.validate.status === 'active') {
    const passes = plan.phases.validate.auditPasses;
    const lastPass = passes[passes.length - 1];
    const latestAttempt = lastPass?.audit?.attempts?.[lastPass.audit.attempts.length - 1];

    if (latestAttempt?.status === 'running') return WAIT;
    if (lastPass?.fix?.attempts) {
      const fixAttempt = lastPass.fix.attempts[lastPass.fix.attempts.length - 1];
      if (fixAttempt?.status === 'running') return WAIT;
    }

    if (!lastPass) {
      return { kind: 'dispatch_audit', note: 'Running plan audit pass 1...', stage: 'plan', phase: 'validate' };
    }
    if (lastPass.status === 'revised') {
      if (!lastPass.fix || lastPass.fix.attempts.length === 0) {
        return { kind: 'apply_findings', note: `Applying plan audit pass ${passes.length} findings...`, stage: 'plan', phase: 'validate', data: { passNo: lastPass.passNo } };
      }
      if (passes.length < 5) {
        return { kind: 'dispatch_audit', note: `Running plan audit pass ${passes.length + 1}...`, stage: 'plan', phase: 'validate' };
      }
    }
    return { kind: 'approve_stage', note: 'Plan audit done — advancing to Execute...', stage: 'plan', phase: 'validate' };
  }

  // Execute
  if (execute.status === 'active') {
    const implRepos = execute.phases.implement.repos;
    for (const repo of implRepos) {
      const last = repo.attempts[repo.attempts.length - 1];
      if (last?.status === 'running') return WAIT;
    }
    if (implRepos.length === 0 || implRepos.every((r) => r.attempts.length === 0)) {
      return { kind: 'dispatch_execute', note: 'Dispatching execution...', stage: 'execute', phase: 'implement' };
    }
    return { kind: 'advance_stage', note: 'Execution complete — advancing to Review...', stage: 'review', phase: 'review' };
  }

  // Review — review pass loop
  if (review.status === 'active') {
    for (const repo of review.phases.review.repos) {
      const passes = repo.reviewPasses;
      const lastPass = passes[passes.length - 1];
      const reviewAttempt = lastPass?.review?.attempts?.[lastPass.review.attempts.length - 1];
      if (reviewAttempt?.status === 'running') return WAIT;
      if (lastPass?.fix?.attempts) {
        const fixAttempt = lastPass.fix.attempts[lastPass.fix.attempts.length - 1];
        if (fixAttempt?.status === 'running') return WAIT;
      }
    }

    const hasAnyRepo = review.phases.review.repos.length > 0;
    if (!hasAnyRepo) {
      return { kind: 'dispatch_review', note: 'Running code review...', stage: 'review', phase: 'review' };
    }

    const allDone = review.phases.review.repos.every((r) => {
      const last = r.reviewPasses[r.reviewPasses.length - 1];
      return last && (last.status === 'clean' || r.reviewPasses.length >= 5);
    });
    if (!allDone) {
      const repo = review.phases.review.repos[0];
      const last = repo.reviewPasses[repo.reviewPasses.length - 1];
      if (last?.status === 'revised') {
        if (!last.fix || last.fix.attempts.length === 0) {
          return { kind: 'apply_review_findings', note: `Applying review pass ${repo.reviewPasses.length} findings...`, stage: 'review', phase: 'review' };
        }
        if (repo.reviewPasses.length < 5) {
          return { kind: 'dispatch_review', note: `Running review pass ${repo.reviewPasses.length + 1}...`, stage: 'review', phase: 'review' };
        }
      }
    }
    return { kind: 'advance_stage', note: 'Review done — advancing to Journal...', stage: 'journal', phase: 'journal' };
  }

  // Journal
  if (journal.status === 'active') {
    const harvestAttempts = journal.phases.journal.attempts;
    const lastHarvest = harvestAttempts[harvestAttempts.length - 1];
    if (lastHarvest?.status === 'running') return WAIT;

    if (!lastHarvest || lastHarvest.status === 'failed') {
      return { kind: 'dispatch_harvest', note: 'Harvesting learnings...', stage: 'journal', phase: 'journal' };
    }

    const learnings = journal.phases.journal.learnings;
    const unapproved = learnings.findIndex((l) => l.status === 'proposed');
    if (unapproved >= 0) {
      return { kind: 'approve_learning', note: `Approving learning ${unapproved + 1}/${learnings.length}...`, stage: 'journal', phase: 'journal', data: { learningIndex: unapproved } };
    }

    const allRecorded = learnings.every((l) => l.status === 'recorded');
    if (!allRecorded) {
      const recordAttempts = journal.phases.summary.attempts;
      const lastRecord = recordAttempts[recordAttempts.length - 1];
      if (lastRecord?.status === 'running') return WAIT;
      return { kind: 'dispatch_record', note: 'Recording learnings...', stage: 'journal', phase: 'summary' };
    }

    return { kind: 'mark_complete', note: 'Marking project complete...', stage: 'journal', phase: 'summary' };
  }

  return COMPLETE;
}
