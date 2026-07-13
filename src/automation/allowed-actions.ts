import type { Details } from '@/details/schema';
import { resolveNextActionFromDetails, type AutoAction } from '@/automation/details-resolver';
import { auditInFlight, type AuditPassLike } from '@/automation/audit-loop-policy';
import { canAutoStart } from '@/automation/policy';

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
    // Only add the generic manual approve_task if the resolver didn't already emit one
    // (it carries data.taskId for the first unvalidated task). Two entries for one kind
    // would let performTransition's by-kind match pick the wrong (task-id-less) one.
    if (stages.plan.phases.refine.tasks.some((t) => t.approvals.length === 0)
        && !set.some((a) => a.kind === 'approve_task')) {
      set.push({ kind: 'approve_task', note: 'Approve plan task', stage: 'plan', phase: 'refine' });
    }
  }

  // Each active audit-loop phase carries three manual affordances: `advance` (gated —
  // the early-exit after ≥1 pass), and the in-place `refine` actions (re-audit + apply
  // findings) which are NOT gated on the pass verdict. A human in manual mode may sit
  // on a clean pass and apply its advisory (medium/low) findings, or re-run the audit,
  // as many times as they like — the state machine only says advancing is *permitted*,
  // never that refining is *forbidden*. Everything here is suppressed while a pass is
  // in flight (a batch is running).
  const auditPhases: Array<{ passes: AuditPassLike[]; advance: Action; refine: Action[] }> = [];
  if (stages.spec.status === 'active' && stages.spec.phases.finalize.status === 'active') {
    const passes = stages.spec.phases.finalize.auditPasses as unknown as AuditPassLike[];
    auditPhases.push({
      passes,
      advance: { kind: 'approve_stage', note: 'Advance spec (manual)', stage: 'spec', phase: 'finalize' },
      refine: [
        { kind: 'dispatch_audit', note: 'Re-run spec audit', stage: 'spec', phase: 'finalize' },
        ...(passes.length >= 1
          ? [{ kind: 'apply_findings', note: 'Apply spec audit findings', stage: 'spec', phase: 'finalize', data: { passNo: passes.length } } as Action]
          : []),
      ],
    });
  }
  if (stages.plan.status === 'active' && stages.plan.phases.validate.status === 'active') {
    const passes = stages.plan.phases.validate.auditPasses as unknown as AuditPassLike[];
    auditPhases.push({
      passes,
      advance: { kind: 'approve_stage', note: 'Advance plan (manual)', stage: 'plan', phase: 'validate' },
      refine: [
        { kind: 'dispatch_audit', note: 'Re-run plan audit', stage: 'plan', phase: 'validate' },
        ...(passes.length >= 1
          ? [{ kind: 'apply_findings', note: 'Apply plan audit findings', stage: 'plan', phase: 'validate', data: { passNo: passes.length } } as Action]
          : []),
      ],
    });
  }
  if (stages.review.status === 'active') {
    for (const repo of stages.review.phases.review.repos) {
      const passes = repo.reviewPasses.map((p) => ({ ...p, audit: p.review })) as unknown as AuditPassLike[];
      auditPhases.push({
        passes,
        advance: { kind: 'advance_stage', note: 'Advance review (manual)', stage: 'journal', phase: 'journal' },
        refine: [
          { kind: 'dispatch_review', note: 'Re-run code review', stage: 'review', phase: 'review', data: { repoId: repo.repoId } },
          ...(passes.length >= 1
            ? [{ kind: 'apply_review_findings', note: 'Apply review findings', stage: 'review', phase: 'review', data: { repoId: repo.repoId } } as Action]
            : []),
        ],
      });
    }
  }

  const sameAction = (a: Action, b: Action): boolean =>
    a.kind === b.kind && (a.data?.repoId ?? null) === (b.data?.repoId ?? null);
  for (const ap of auditPhases) {
    if (auditInFlight(ap.passes)) continue; // nothing while a batch runs for this phase
    if (ap.passes.length >= 1 && !set.some((a) => a.kind === ap.advance.kind)) {
      set.push(ap.advance);
    }
    for (const r of ap.refine) {
      if (!set.some((a) => sameAction(a, r))) set.push(r);
    }
  }

  // ── Cross-cutting: start auto (status is 'off' here — the running case returned
  //    early in allowedActions). Only offered at/after spec/finalize (canAutoStart).
  if (canAutoStart(details)) {
    set.push({ kind: 'start_auto', note: 'Let Forge drive', stage: '', phase: '' });
  }
}
