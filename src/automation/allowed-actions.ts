import type { Details } from '@/details/schema';
import { resolveNextActionFromDetails, type AutoAction } from '@/automation/details-resolver';
import { auditInFlight, type AuditPassLike } from '@/automation/audit-loop-policy';

export type Mode = 'auto' | 'manual';
export type Action = AutoAction; // { kind, note, stage, phase, data? }

/**
 * The permitted transition SET for the current details + mode (spec §4.1). The
 * single place the locked criteria table lives. Deterministic total order (AC15):
 * the best-practice action first, then manual-only extras.
 *
 * Auto = [legacy resolver action] (behaviour-neutral). Manual adds the audit-loop
 * early-exit (advance after ≥1 pass) and, later, take_over + content actions.
 */
export function allowedActions(details: Details, mode: Mode): Action[] {
  // While auto drives, the ONLY thing a human may do is take over (gate criterion 4).
  if (mode === 'manual' && details.automation.status === 'running') {
    return [{ kind: 'take_over', note: 'Stop & take over', stage: '', phase: '' }];
  }
  const best = resolveNextActionFromDetails(details);
  const set: Action[] = best.kind === 'wait' ? [] : [best];
  if (mode === 'manual') addManualExtras(details, set);
  return set;
}

/**
 * Auto's entry point is gated to `spec/finalize` or later (spec §3 framework
 * decision — Design phases are still human-authored). Inlined here for Task 8b-3;
 * Task 11 factors it into a shared `canAutoStart` helper.
 */
function canAutoStartInline(d: Details): boolean {
  const { stages } = d;
  if (stages.spec.status === 'active') return stages.spec.phases.finalize.status === 'active';
  return (['plan', 'execute', 'review', 'journal'] as const).some((s) => stages[s].status === 'active');
}

/**
 * Manual-only options auto never takes. Today: the audit-loop early-exit — a human
 * may advance an audit-loop phase after ≥1 pass (if nothing is in flight), even with
 * findings still open. (Auto keeps iterating until clean-or-5+fixes.) `take_over` and
 * content actions are layered in later tasks.
 */
function addManualExtras(details: Details, set: Action[]): void {
  const { stages } = details;

  // ── Exploration (Design phase — manual-only; auto never drives it, so the auto
  //    set here is empty and this builds the manual set). Transitions reuse the
  //    generic advance_phase / advance_stage actions. Task 8b-1.
  const ex = stages.exploration;
  if (ex.status === 'active') {
    if (ex.phases.brief.status === 'active') {
      set.push({ kind: 'set_brief', note: 'Save brief', stage: 'exploration', phase: 'brief' });
      set.push({ kind: 'propose_discover_tasks', note: 'Analyze sources', stage: 'exploration', phase: 'brief' });
      // Draft tasks are dispatched from the brief/fan-out view before the phase
      // formally advances to Discover, so run_discover_tasks is valid here too
      // (matches the client UX; auto never drives exploration).
      if (ex.phases.discover.tasks.some((t) => t.status === 'draft')) {
        set.push({ kind: 'run_discover_tasks', note: 'Run exploration tasks', stage: 'exploration', phase: 'discover' });
      }
      if (ex.phases.discover.tasks.length >= 1) {
        set.push({ kind: 'advance_phase', note: 'Continue to Discover', stage: 'exploration', phase: 'discover' });
      }
    } else if (ex.phases.discover.status === 'active') {
      const tasks = ex.phases.discover.tasks;
      const drafts = tasks.filter((t) => t.status === 'draft').length;
      const dispatched = tasks.filter((t) => t.status !== 'draft').length;
      const recorded = tasks.filter((t) => t.status === 'recorded').length;
      if (drafts > 0) set.push({ kind: 'run_discover_tasks', note: 'Run exploration tasks', stage: 'exploration', phase: 'discover' });
      if (dispatched > 0 && recorded === dispatched) {
        set.push({ kind: 'advance_phase', note: 'Continue to Synthesize', stage: 'exploration', phase: 'synthesize' });
      }
    } else if (ex.phases.synthesize.status === 'active') {
      if (!ex.phases.synthesize.file) {
        set.push({ kind: 'dispatch_synthesize', note: 'Synthesize exploration', stage: 'exploration', phase: 'synthesize' });
      } else {
        set.push({ kind: 'advance_stage', note: 'Continue to Spec', stage: 'spec', phase: 'outline' });
      }
    }
  }

  // ── Spec Design phases (outline / craft) — manual-only (Task 8b-2). select_components
  //    (outline) + refine_component (craft) content actions are added in Task 10; here
  //    we drive approval + the phase transitions (whose effects already exist).
  const sp = stages.spec;
  if (sp.status === 'active' && sp.phases.outline.status === 'active') {
    set.push({ kind: 'select_components', note: 'Select components', stage: 'spec', phase: 'outline' });
    if ((sp.phases.outline.selectedTemplateIds?.length ?? 0) >= 1) {
      set.push({ kind: 'advance_phase', note: 'Continue to Craft', stage: 'spec', phase: 'craft' });
    }
  } else if (sp.status === 'active' && sp.phases.craft.status === 'active') {
    const comps = sp.phases.craft.components;
    if (comps.length >= 1) set.push({ kind: 'refine_component', note: 'Refine component', stage: 'spec', phase: 'craft' });
    if (comps.some((c) => c.approvals.length === 0)) {
      set.push({ kind: 'approve_component', note: 'Approve component', stage: 'spec', phase: 'craft' });
    } else if (comps.length >= 1) {
      set.push({ kind: 'advance_phase', note: 'Continue to Finalize', stage: 'spec', phase: 'finalize' });
    }
  }

  // ── Plan refine: direct approval. A human may approve any drafted task without
  //    waiting for Forge's validate_task pass (the manual early-exit; auto still
  //    validates-then-approves each task). Task chat stays on its own route.
  if (stages.plan.status === 'active' && stages.plan.phases.refine.status === 'active') {
    if (stages.plan.phases.refine.tasks.some((t) => t.approvals.length === 0)) {
      set.push({ kind: 'approve_task', note: 'Approve plan task', stage: 'plan', phase: 'refine' });
    }
  }

  const auditPhases: Array<{ passes: AuditPassLike[]; advance: Action }> = [];
  if (stages.spec.status === 'active' && stages.spec.phases.finalize.status === 'active') {
    auditPhases.push({
      passes: stages.spec.phases.finalize.auditPasses as unknown as AuditPassLike[],
      advance: { kind: 'approve_stage', note: 'Advance spec (manual)', stage: 'spec', phase: 'finalize' },
    });
  }
  if (stages.plan.status === 'active' && stages.plan.phases.validate.status === 'active') {
    auditPhases.push({
      passes: stages.plan.phases.validate.auditPasses as unknown as AuditPassLike[],
      advance: { kind: 'approve_stage', note: 'Advance plan (manual)', stage: 'plan', phase: 'validate' },
    });
  }
  if (stages.review.status === 'active') {
    for (const repo of stages.review.phases.review.repos) {
      auditPhases.push({
        passes: repo.reviewPasses as unknown as AuditPassLike[],
        advance: { kind: 'advance_stage', note: 'Advance review (manual)', stage: 'journal', phase: 'journal' },
      });
    }
  }

  for (const ap of auditPhases) {
    if (ap.passes.length >= 1 && !auditInFlight(ap.passes) && !set.some((a) => a.kind === ap.advance.kind)) {
      set.push(ap.advance);
    }
  }

  // ── Cross-cutting: start auto (status is 'off' here — the running case returned
  //    early in allowedActions). Only offered at/after spec/finalize (Task 8b-3).
  if (canAutoStartInline(details)) {
    set.push({ kind: 'start_auto', note: 'Let Forge drive', stage: '', phase: '' });
  }
}
