import type { Details } from '@/details/schema';
import { STAGE_ORDER, JournalLearningStatus } from '@/db/enums';
import type { StageKind } from '@/db/enums';
import { auditLoopStep, type AuditPassLike } from '@/automation/audit-loop-policy';
import { isParked } from '@/automation/attempt-status';
// The one display-name map. This module kept a private copy that said 'Journal' where the
// canonical one says 'Reflect' — the name every other surface shows for that stage.
import { STAGE_LABEL } from '@/projects/stage-lifecycle';
import { ACTION_KINDS } from '@/automation/action-schema';

/**
 * Every kind an action may carry: the wire-validated `ACTION_KINDS` plus the two
 * driver-internal ones that never cross the HTTP boundary (`wait` = nothing to do
 * now, `complete` = the driver's own stop signal).
 *
 * Deliberately NOT `string`. A kind the executor doesn't handle used to type-check
 * and fail only at runtime — `driver.ts` carried a live `startsWith('navigate_')`
 * branch for an action family that had already been deleted, and nothing caught it.
 */
export type ActionKind = (typeof ACTION_KINDS)[number] | 'wait' | 'complete';

/** One `project_journal` row, reduced to what the resolver decides on. */
export interface JournalRowState {
  id: string;
  status: JournalLearningStatus;
}

/**
 * State the resolver needs that does NOT live in `details`. Required, not defaulted:
 * journal learnings moved from a details array to the `project_journal` table, and
 * because the resolver kept reading the (now permanently empty) array it concluded
 * "nothing to approve, nothing to record" and completed projects without ever recording
 * their learnings. An absent input must be a compile error, never an empty list.
 */
export interface ResolveContext {
  journalRows: JournalRowState[];
}

export interface AutoAction {
  kind: ActionKind;
  note: string;
  /** A real stage, or `''` for the stage-less actions (`wait`, `complete`, `take_over`). */
  stage: StageKind | '';
  phase: string;
  data?: Record<string, unknown>;
}

const WAIT: AutoAction = { kind: 'wait', note: '', stage: '', phase: '' };
const COMPLETE: AutoAction = { kind: 'complete', note: 'Project complete', stage: '', phase: '' };

const isSkipped = (d: Details, stage: StageKind) => d.stages[stage].status === 'skipped';

/**
 * A stage's DEFINING work — the record that proves it actually ran (not just that
 * its `status` says `done`). This is the completion invariant: a stage marked
 * `done` without this record is a corrupted/skipped stage, not a finished one.
 */
function stageWorkDone(d: Details, stage: StageKind): boolean {
  if (isSkipped(d, stage)) return true;
  const s = d.stages;
  switch (stage) {
    case 'exploration':
      return s.exploration.phases.synthesize.status === 'done' || !!s.exploration.phases.synthesize.file;
    case 'spec':
      return s.spec.phases.finalize.approvals.length > 0;
    case 'plan':
      return s.plan.phases.refine.tasks.length > 0
        && s.plan.phases.refine.tasks.every((t) => t.approvals.length > 0)
        && s.plan.phases.validate.auditPasses.length > 0;
    case 'execute':
      return s.execute.phases.implement.repos.some((r) => r.attempts.some((a) => a.status === 'done'));
    case 'review':
      return s.review.phases.review.repos.some((r) => r.reviewPasses.length > 0);
    case 'journal':
      return s.journal.phases.journal.attempts.some((a) => a.status === 'done');
  }
}

/**
 * The earliest build/design stage (explore→review) whose defining work is NOT
 * recorded — i.e. a stage that was skipped. Returns `null` when every stage did
 * real work. Journal is excluded (it's the active stage at the completion
 * boundary; its own harvest attempt is checked there). This is the guard that
 * makes "Project complete" impossible without execute committing code and review
 * running — so a driver glitch can never silently ship a false completion.
 */
export function firstUnderdoneStage(d: Details): StageKind | null {
  // DERIVED from the canonical order, not listed. Omission here weakens the guard: a
  // stage added to `STAGE_KIND` and forgotten in a hand-written list would simply stop
  // being checked, and this is the check that makes a false "Project complete"
  // impossible. `journal` is the one deliberate exclusion (see above).
  for (const stage of STAGE_ORDER.filter((s) => s !== 'journal')) {
    if (isSkipped(d, stage)) continue;
    if (!stageWorkDone(d, stage)) return stage;
  }
  return null;
}

export function resolveNextActionFromDetails(details: Details, ctx: ResolveContext): AutoAction {
  const spec = details.stages.spec;
  const plan = details.stages.plan;
  const execute = details.stages.execute;
  const review = details.stages.review;
  const journal = details.stages.journal;

  // Spec Finalize — audit loop (one shared policy: auditLoopStep)
  if (spec.status === 'active' && spec.phases.finalize.status === 'active') {
    const step = auditLoopStep(spec.phases.finalize.auditPasses as unknown as AuditPassLike[]);
    switch (step.kind) {
      case 'wait': return WAIT;
      case 'dispatch_audit': return { kind: 'dispatch_audit', note: `Running spec audit pass ${step.passNo}...`, stage: 'spec', phase: 'finalize' };
      case 'apply_findings': return { kind: 'apply_findings', note: `Applying spec audit pass ${step.passNo} findings...`, stage: 'spec', phase: 'finalize', data: { passNo: step.passNo } };
      case 'advance': return { kind: 'approve_stage', note: 'Forge approved the spec', stage: 'spec', phase: 'finalize' };
    }
  }

  // Plan Refine — author + validate + approve tasks
  if (plan.status === 'active' && plan.phases.refine.status === 'active') {
    if (!plan.phases.refine.file) {
      // Plan authoring hard-fails with no linked repository (buildPlanAuthoringRequest
      // throws), so auto mode must WAIT for repo linkage rather than dispatch into an
      // error every tick.
      if ((details.repos ?? []).length === 0) return WAIT;
      const authorAttempts = plan.phases.refine.attempts;
      const last = authorAttempts[authorAttempts.length - 1];
      if (isParked(last)) return WAIT;
      // Bounded retry (matches the audit-loop's 5-pass cap): re-author only while
      // failed attempts are under the cap, so a persistently-failing plan-author
      // (e.g. MMA keeps writing a section-less plan) can't re-dispatch forever.
      const failed = authorAttempts.filter((a) => a.status === 'failed').length;
      if ((!last || last.status === 'failed') && failed < 5) {
        return { kind: 'dispatch_plan_author', note: 'Authoring plan from spec...', stage: 'plan', phase: 'refine' };
      }
      return WAIT;
    }

    const tasks = plan.phases.refine.tasks;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.approvals.length > 0) continue;

      const lastAttempt = t.attempts[t.attempts.length - 1];
      if (isParked(lastAttempt)) return WAIT;
      if (!lastAttempt || lastAttempt.status === 'failed') {
        return { kind: 'validate_task', note: `Validating task ${i + 1}/${tasks.length}: ${t.title}`, stage: 'plan', phase: 'refine', data: { taskId: t.id, taskTitle: t.title, taskNum: i + 1, totalTasks: tasks.length } };
      }
      return { kind: 'approve_task', note: `Approving task ${i + 1}/${tasks.length}: ${t.title}`, stage: 'plan', phase: 'refine', data: { taskId: t.id } };
    }

    return { kind: 'advance_phase', note: 'All tasks approved — running plan audit...', stage: 'plan', phase: 'validate' };
  }

  // Plan Validate — audit loop (same shared policy)
  if (plan.status === 'active' && plan.phases.validate.status === 'active') {
    const step = auditLoopStep(plan.phases.validate.auditPasses as unknown as AuditPassLike[]);
    switch (step.kind) {
      case 'wait': return WAIT;
      case 'dispatch_audit': return { kind: 'dispatch_audit', note: `Running plan audit pass ${step.passNo}...`, stage: 'plan', phase: 'validate' };
      case 'apply_findings': return { kind: 'apply_findings', note: `Applying plan audit pass ${step.passNo} findings...`, stage: 'plan', phase: 'validate', data: { passNo: step.passNo } };
      case 'advance': return { kind: 'approve_stage', note: 'Plan audit done — advancing to Execute...', stage: 'plan', phase: 'validate' };
    }
  }

  // Execute
  if (execute.status === 'active') {
    const implRepos = execute.phases.implement.repos;
    // A running implement attempt (recorded at dispatch) → WAIT until its terminal
    // flips it. This is what prevents a duplicate execute at the terminal moment.
    for (const repo of implRepos) {
      const last = repo.attempts[repo.attempts.length - 1];
      if (isParked(last)) return WAIT;
    }
    // Dispatch when NO repo has a successful (done) attempt yet — covers the first
    // dispatch (empty) AND a retry after a `failed` attempt. Advancing on a failed
    // execute (no committed code) is exactly the skip the completion invariant bans.
    const hasDone = implRepos.some((r) => r.attempts.some((a) => a.status === 'done'));
    if (!hasDone) {
      return { kind: 'dispatch_execute', note: 'Dispatching execution...', stage: 'execute', phase: 'implement' };
    }
    return { kind: 'advance_stage', note: 'Execution complete — advancing to Review...', stage: 'review', phase: 'review' };
  }

  // Review — per-repo review pass loop, each repo driven by the SAME audit-loop
  // policy (auditLoopStep). This fixes the old line-191 bug: a repo at the 5-pass cap
  // whose last pass is still `revised`+unfixed now applies its fix BEFORE advancing,
  // exactly like spec/plan — instead of silently shipping unfixed findings to Journal.
  if (review.status === 'active') {
    const repos = review.phases.review.repos;
    if (repos.length === 0) {
      return { kind: 'dispatch_review', note: 'Running code review...', stage: 'review', phase: 'review' };
    }
    // Act on the FIRST repo that is not yet done (any in-flight repo → WAIT).
    // Review passes carry their dispatch attempts under `review` (spec/plan use
    // `audit`); adapt to the shared policy's shape so in-flight detection works.
    for (const repo of repos) {
      const passesForPolicy = repo.reviewPasses.map((p) => ({ ...p, audit: p.review })) as unknown as AuditPassLike[];
      const step = auditLoopStep(passesForPolicy);
      const passNo = repo.reviewPasses.length;
      switch (step.kind) {
        case 'wait': return WAIT;
        case 'advance': continue; // this repo is done — check the next
        case 'dispatch_audit': return { kind: 'dispatch_review', note: passNo === 0 ? 'Running code review...' : `Running review pass ${step.passNo}...`, stage: 'review', phase: 'review', data: { repoId: repo.repoId } };
        case 'apply_findings': return { kind: 'apply_review_findings', note: `Applying review pass ${step.passNo} findings...`, stage: 'review', phase: 'review', data: { repoId: repo.repoId } };
      }
    }
    return { kind: 'advance_stage', note: 'Review done — advancing to Journal...', stage: 'journal', phase: 'journal' };
  }

  // Journal
  if (journal.status === 'active') {
    const harvestAttempts = journal.phases.journal.attempts;
    const lastHarvest = harvestAttempts[harvestAttempts.length - 1];
    if (isParked(lastHarvest)) return WAIT;

    if (!lastHarvest || lastHarvest.status === 'failed') {
      return { kind: 'dispatch_harvest', note: 'Harvesting learnings...', stage: 'journal', phase: 'journal' };
    }

    const rows = ctx.journalRows;
    const unapproved = rows.findIndex((r) => r.status === 'proposed');
    if (unapproved >= 0) {
      // The effect addresses the row by id — an index into a details array could not
      // name it, which is why this branch never worked against the old shape.
      return { kind: 'approve_learning', note: `Approving learning ${unapproved + 1}/${rows.length}...`, stage: 'journal', phase: 'journal', data: { rowId: rows[unapproved].id } };
    }

    // A learning is "settled" once recorded OR removed (a human can `remove` one
    // mid-run; dispatch_record only flips kept→recorded, so requiring EVERY learning
    // to be `recorded` would deadlock on a removed one). Record only when a kept
    // learning still awaits recording.
    const needsRecord = rows.some((r) => r.status === 'kept');
    if (needsRecord) {
      const recordAttempts = journal.phases.summary.attempts;
      const lastRecord = recordAttempts[recordAttempts.length - 1];
      if (isParked(lastRecord)) return WAIT;
      return { kind: 'dispatch_record', note: 'Recording learnings...', stage: 'journal', phase: 'summary' };
    }

    // COMPLETION INVARIANT: never mark complete if a build/design stage was
    // skipped (marked done without doing its work — e.g. a driver glitch jumped
    // past execute). Reopen the earliest skipped stage so the pipeline redoes it.
    const underdone = firstUnderdoneStage(details);
    if (underdone) {
      return { kind: 'reopen_stage', note: `${STAGE_LABEL[underdone]} was skipped — reopening to finish it`, stage: underdone, phase: '' };
    }

    return { kind: 'mark_complete', note: 'Marking project complete...', stage: 'journal', phase: 'summary' };
  }

  // Bottom fallthrough — reached only when NO stage branch above matched. If a stage is
  // `active` that this resolver does NOT drive — exploration, or spec outline/craft, the
  // HAND-AUTHORED design work — WAIT: reopening here would wipe all downstream work in an
  // infinite loop (a stage reopen re-activates that same undriveable stage).
  //
  // "auto-mode never drives Design" is what this said, and it is not true: the branches
  // above drive spec FINALIZE (audit → apply → approve_stage) and the whole PLAN stage,
  // both of which are design-phase work (`STAGE_PHASE`). The line that matters is
  // hand-authored vs driven, not design vs build. The manual said the same wrong thing.
  //
  // The completion invariant only applies once EVERY stage claims `done` (the
  // corrupted-complete case).
  const anyActive = Object.values(details.stages).some((s) => s.status === 'active');
  if (anyActive) return WAIT;
  const underdone = firstUnderdoneStage(details);
  if (underdone) {
    return { kind: 'reopen_stage', note: `${STAGE_LABEL[underdone]} was skipped — reopening to finish it`, stage: underdone, phase: '' };
  }
  return COMPLETE;
}
