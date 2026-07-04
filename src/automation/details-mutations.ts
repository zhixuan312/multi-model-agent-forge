import { buildInitialDetails, type Details } from '@/details/schema';
import { STAGE_ORDER, type StageKind } from '@/db/enums';

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
 * Resolve the current `running` activity line IN PLACE — the core of the "one line
 * per activity" log. Scans from the end for the most-recent unresolved `action`
 * line for `stage` and finalizes it (kind → done/error, detail → milestone label,
 * stamped duration). If none exists (e.g. a manual dispatch the driver never
 * announced), appends a fresh terminal line. Pure: `at` is passed in, never read
 * from the clock, so it's deterministic and unit-testable.
 */
export function resolveRunningEventInPlace(
  d: Details,
  opts: { stage: string; phase: string; detail: string; kind?: 'done' | 'error'; durationMs?: number; at: string },
): Details {
  for (let i = d.events.length - 1; i >= 0; i--) {
    const e = d.events[i];
    if ((e.kind ?? 'action') === 'action' && e.stage === opts.stage) {
      // Preserve the pass/iteration number from the running line so the resolved
      // milestone stays distinguishable across a loop ("Audited spec" →
      // "Audited spec (pass 3)"). The running note carries it ("Running spec audit
      // pass 3"); the static milestone label does not.
      const m = e.detail.match(/\bpass (\d+)\b/i);
      const detail = m && !/\bpass\b/i.test(opts.detail) ? `${opts.detail} (pass ${m[1]})` : opts.detail;
      e.kind = opts.kind ?? 'done';
      e.detail = detail;
      if (opts.durationMs != null) e.durationMs = opts.durationMs;
      return d;
    }
  }
  d.events.push({ stage: opts.stage, phase: opts.phase, detail: opts.detail, kind: opts.kind ?? 'done', durationMs: opts.durationMs, at: opts.at });
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

/** The async plan-author batch failed → flip the open `running` attempt to
 * `failed` and log an error line, so the resolver re-dispatches (bounded by the
 * in-flight guard) instead of WAITing forever. Returns whether it flipped one. */
export function failStuckAuthorAttempt(d: Details, at: string): boolean {
  const atts = d.stages.plan.phases.refine.attempts;
  const a = atts[atts.length - 1];
  if (!a || a.status !== 'running') return false;
  a.status = 'failed';
  d.events.push({ stage: 'plan', phase: 'refine', detail: 'Plan author failed — retrying', kind: 'error', at });
  return true;
}

/** A plan task was self-validated → a `done` attempt so the resolver advances to
 * `approve_task` instead of re-validating the same task forever. */
export function recordTaskValidation(d: Details, taskId: string, batchId: string, at: string): Details {
  const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === taskId);
  if (task) task.attempts.push({ batchId, status: 'done', at });
  return d;
}

/** The plan was executed for a repo → a `done` implement attempt (find-or-create
 * the per-repo entry) so the resolver advances to Review; tasks marked committed. */
export function recordImplementAttempt(d: Details, repoId: string, batchId: string, at: string): Details {
  const repos = d.stages.execute.phases.implement.repos;
  let entry = repos.find((x) => x.repoId === repoId);
  if (!entry) { entry = { repoId, attempts: [] }; repos.push(entry); }
  entry.attempts.push({ batchId, status: 'done', at });
  for (const t of d.stages.plan.phases.refine.tasks) t.status = 'committed';
  return d;
}

/** A code-review pass completed for a repo → append the pass (`revised` when it
 * carried critical/high findings, else `clean`) so the resolver either applies
 * findings or advances. */
export function recordReviewPass(d: Details, repoId: string, batchId: string, blocking: boolean, at: string): Details {
  const repos = d.stages.review.phases.review.repos;
  let entry = repos.find((x) => x.repoId === repoId);
  if (!entry) { entry = { repoId, reviewPasses: [] }; repos.push(entry); }
  entry.reviewPasses.push({
    passNo: entry.reviewPasses.length + 1,
    status: blocking ? 'revised' : 'clean',
    review: { attempts: [{ batchId, status: 'done', at }] },
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
