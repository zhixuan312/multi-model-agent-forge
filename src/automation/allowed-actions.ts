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
}
