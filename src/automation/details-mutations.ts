import { buildInitialDetails, type Details, type Attempt } from '@/details/schema';
import { STAGE_ORDER, type StageKind } from '@/db/enums';

/**
 * The CENTRAL registry of async-dispatched attempts that can get stuck `running`
 * if their MMA batch fails (the terminal handler only runs on SUCCESS, so a failed
 * batch never closes the attempt). This is the single source that drives the ONE
 * `reconcileStuckAttempts` — instead of a bespoke reconcile + fail mutator per
 * handler. Add a row here for each new async route; sync routes block the driver
 * (dispatchMma throws on a failed envelope) so they never leave a stuck attempt.
 *
 * `open(d)` returns the currently-open `running` attempt for that route, or
 * `undefined` (already closed / never dispatched). Guards live here too, e.g.
 * plan-author is only "open" while `refine.file` is unset (the handler's success
 * signal). Returns a live reference into `d` so the reconcile can flip it in place.
 */
export const RECONCILABLE_ATTEMPTS: ReadonlyArray<{
  stage: string;
  phase: string;
  label: string;
  open: (d: Details) => Attempt | undefined;
}> = [
  {
    stage: 'plan', phase: 'refine', label: 'Plan author',
    open: (d) => {
      const r = d.stages.plan.phases.refine;
      if (r.file) return undefined; // handler already closed the attempt out
      const a = r.attempts[r.attempts.length - 1];
      return a?.status === 'running' ? a : undefined;
    },
  },
  {
    stage: 'execute', phase: 'implement', label: 'Execution',
    open: (d) => {
      for (const repo of d.stages.execute.phases.implement.repos) {
        const a = repo.attempts[repo.attempts.length - 1];
        if (a?.status === 'running') return a;
      }
      return undefined;
    },
  },
];

/** Every currently-open `running` async attempt across all routes (live references
 * into `d`), tagged with its stage/phase/label. Pure → the reconcile's location
 * logic is unit-tested without a DB. */
export function openRunningAttempts(d: Details): Array<{ stage: string; phase: string; label: string; attempt: Attempt }> {
  const out: Array<{ stage: string; phase: string; label: string; attempt: Attempt }> = [];
  for (const loc of RECONCILABLE_ATTEMPTS) {
    const attempt = loc.open(d);
    if (attempt) out.push({ stage: loc.stage, phase: loc.phase, label: loc.label, attempt });
  }
  return out;
}

/** The first phase of each stage — the one activated when the stage becomes active
 * so the resolver enters its branch. Single source for advance + reopen. */
export const STAGE_FIRST_PHASE: Record<StageKind, string> = {
  exploration: 'brief', spec: 'outline', plan: 'refine', execute: 'configure', review: 'review', journal: 'journal',
};

/**
 * Reopen a skipped stage IN PLACE (the completion-invariant recovery): reset the
 * target stage AND every stage after it to a clean pending template — so their
 * skipped/half-corrupt work is redone from scratch — then re-activate the target at
 * its first phase. Pure: `at` is passed in, so it's deterministic and testable.
 */
export function reopenStageInPlace(d: Details, toStage: StageKind, at: string): Details {
  const clean = buildInitialDetails();
  const idx = STAGE_ORDER.indexOf(toStage);
  for (let i = idx; i < STAGE_ORDER.length; i++) {
    const kind = STAGE_ORDER[i];
    (d.stages as Record<string, unknown>)[kind] = clean.stages[kind];
  }
  const target = d.stages[toStage];
  target.status = 'active';
  if (!target.startedAt) target.startedAt = at;
  const phases = target.phases as Record<string, { status: string }>;
  const fp = STAGE_FIRST_PHASE[toStage];
  if (phases[fp]) phases[fp].status = 'active';
  return d;
}

/**
 * Pure details mutators for the automation driver — one per unit of gating state
 * that an action records so the resolver can advance. Each is a `(Details, …) =>
 * Details` that mutates in place and returns the same object, so it slots
 * straight into `updateDetails(db, id, mutator)`. Timestamps are passed in (never
 * read from the clock here) so the functions stay deterministic and unit-testable.
 *
 * These are the single source of truth for the resolver's read/write contract:
 * every gate `resolveNextActionFromDetails` reads has exactly one writer here.
 */

/** Plan author dispatched (async) → a `running` refine attempt so the resolver
 * WAITs (instead of re-dispatching) until the plan-author handler closes it out. */
export function recordAuthorAttempt(d: Details, batchId: string, at: string): Details {
  d.stages.plan.phases.refine.attempts.push({ batchId, status: 'running', at });
  return d;
}

/** A plan task was self-validated → a `done` attempt so the resolver advances to
 * `approve_task` instead of re-validating the same task forever. */
export function recordTaskValidation(d: Details, taskId: string, batchId: string, at: string): Details {
  const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === taskId);
  if (task) task.attempts.push({ batchId, status: 'done', at });
  return d;
}

/** Execute dispatched (async) for a repo → a `running` implement attempt so the
 * resolver WAITs (instead of re-dispatching) until the execute-pipeline handler
 * closes it out. Mirrors `recordAuthorAttempt`; closes the terminal-moment race
 * where the batch is `done` but its attempt isn't recorded yet → duplicate execute. */
export function recordExecuteAttempt(d: Details, repoId: string, batchId: string, at: string): Details {
  const repos = d.stages.execute.phases.implement.repos;
  let entry = repos.find((x) => x.repoId === repoId);
  if (!entry) { entry = { repoId, attempts: [] }; repos.push(entry); }
  entry.attempts.push({ batchId, status: 'running', at });
  return d;
}

/** The plan was executed for a repo → FLIP the open `running` implement attempt to
 * `done` (the resolver then advances to Review; tasks marked committed). Falls back
 * to appending a `done` attempt if no running one exists (defensive). */
export function recordImplementAttempt(d: Details, repoId: string, batchId: string, at: string): Details {
  const repos = d.stages.execute.phases.implement.repos;
  let entry = repos.find((x) => x.repoId === repoId);
  if (!entry) { entry = { repoId, attempts: [] }; repos.push(entry); }
  const running = entry.attempts.find((a) => a.status === 'running');
  if (running) { running.status = 'done'; running.at = at; }
  else entry.attempts.push({ batchId, status: 'done', at });
  for (const t of d.stages.plan.phases.refine.tasks) t.status = 'committed';
  return d;
}

/** A code-review pass completed for a repo → append the pass (`revised` when it
 * carried critical/high findings, else `clean`) so the resolver either applies
 * findings or advances. */
/** Record one audit round as a new pass on the spec-finalize or plan-validate
 * audit loop, carrying the read-route result's context block id (or null) so the
 * NEXT round can be dispatched as a delta. Single writer for both spec & plan. */
export function recordAuditPass(
  d: Details,
  scope: 'spec' | 'plan',
  passNo: number,
  verdict: 'revised' | 'clean',
  batchId: string,
  at: string,
  contextBlockId: string | null,
): Details {
  const passes = scope === 'spec'
    ? d.stages.spec.phases.finalize.auditPasses
    : d.stages.plan.phases.validate.auditPasses;
  passes.push({
    passNo,
    status: verdict,
    audit: { attempts: [{ batchId, status: 'done', at, contextBlockId }] },
  });
  return d;
}

export function recordReviewPass(d: Details, repoId: string, batchId: string, blocking: boolean, at: string, contextBlockId: string | null): Details {
  const repos = d.stages.review.phases.review.repos;
  let entry = repos.find((x) => x.repoId === repoId);
  if (!entry) { entry = { repoId, reviewPasses: [] }; repos.push(entry); }
  entry.reviewPasses.push({
    passNo: entry.reviewPasses.length + 1,
    status: blocking ? 'revised' : 'clean',
    review: { attempts: [{ batchId, status: 'done', at, contextBlockId }] },
  });
  return d;
}

/** Review findings were applied for a repo → record the fix attempt on the latest
 * pass so the resolver runs the next review pass (or, at the cap, advances). */
export function recordReviewFix(d: Details, repoId: string, batchId: string, at: string): Details {
  const entry = d.stages.review.phases.review.repos.find((x) => x.repoId === repoId);
  const lp = entry?.reviewPasses[entry.reviewPasses.length - 1];
  if (lp) lp.fix = { attempts: [{ batchId, status: 'done', at }] };
  return d;
}

/** Learnings were harvested → a `done` journal attempt so the resolver moves on
 * to approving the (already-pushed) learnings instead of re-harvesting. */
export function recordHarvestAttempt(d: Details, batchId: string, at: string): Details {
  d.stages.journal.phases.journal.attempts.push({ batchId, status: 'done', at });
  return d;
}
