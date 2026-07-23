import { eq, and } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails, type Details } from '@/details/schema';
import { reopenStageInPlace, STAGE_FIRST_PHASE } from '@/automation/details-mutations';
import { STAGE_ORDER, type StageKind, type ProjectPhase } from '@/db/enums';

export class DetailsVersionConflict extends Error {
  constructor(projectId: string, retries: number) {
    super(`Optimistic lock failed for project ${projectId} after ${retries} retries`);
    this.name = 'DetailsVersionConflict';
  }
}

/**
 * Optimistic (compare-and-set on detailsVersion) read-modify-write of project.details. `retries` is
 * the CAS attempt ceiling — raise it for hot, high-contention paths (e.g. a discover fan-out where
 * many tasks flip to `recorded` at once) so a legitimate write isn't lost to contention.
 */
export async function updateDetails(
  db: Db,
  projectId: string,
  mutator: (d: Details) => Details,
  retries = 3,
): Promise<Details> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const [row] = await db
      .select({ details: project.details, detailsVersion: project.detailsVersion })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);

    if (!row?.details) throw new Error(`Project ${projectId} has no details`);
    const current = validateDetails(row.details);
    const updated = mutator(current);
    const validated = validateDetails(updated);

    const result = await db
      .update(project)
      .set({
        details: validated,
        detailsVersion: row.detailsVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(project.id, projectId), eq(project.detailsVersion, row.detailsVersion)))
      .returning({ id: project.id });

    if (result.length > 0) return validated;
  }
  throw new DetailsVersionConflict(projectId, retries);
}

/** Design (exploration·spec·plan) → build (execute·review) → learn (journal). */
const STAGE_PHASE: Record<StageKind, 'design' | 'build' | 'learn'> = {
  exploration: 'design', spec: 'design', plan: 'design',
  execute: 'build', review: 'build', journal: 'learn',
};

const isPassed = (status: string) => status === 'done' || status === 'skipped';

/**
 * The pure projection of `details.stages` onto the denormalized (currentStage, phase)
 * pair — the SINGLE source of the derivation rule, shared by the DB writer below and
 * by any read that needs the columns (e.g. the dashboard list). Cases:
 *  - a stage is active → that stage + its phase (the normal mid-flow state);
 *  - all six stages done/skipped → journal / `completed` (a finished project — this is what
 *    activates the otherwise-dormant `completed` phase, since `mark_complete` only
 *    stamps `completedAt`, not the phase);
 *  - otherwise (a transient between-stages state) → the furthest passed stage, or the
 *    initial exploration / design when nothing has started.
 */
export function deriveStageAndPhase(d: Details): { currentStage: StageKind; phase: ProjectPhase } {
  const active = STAGE_ORDER.find((k) => d.stages[k].status === 'active');
  if (active) return { currentStage: active, phase: STAGE_PHASE[active] };
  if (STAGE_ORDER.every((k) => isPassed(d.stages[k].status))) {
    return { currentStage: 'journal', phase: 'completed' };
  }
  const lastPassed = [...STAGE_ORDER].reverse().find((k) => isPassed(d.stages[k].status));
  if (lastPassed) return { currentStage: lastPassed, phase: STAGE_PHASE[lastPassed] };
  return { currentStage: 'exploration', phase: 'design' };
}

/**
 * The single writer of the denormalized `currentStage`/`phase` columns (spec §4.4,
 * AC8): mirror them from `details` via `deriveStageAndPhase`. Called by
 * `performTransition` after every effect, so the columns can never drift — including
 * on `mark_complete`, where no stage is active but the project is `completed`.
 */
export async function deriveCurrentStage(db: Db, projectId: string): Promise<void> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return;
  const { currentStage, phase } = deriveStageAndPhase(validateDetails(row.details));
  await db.update(project).set({ currentStage, phase, updatedAt: new Date() }).where(eq(project.id, projectId));
}

export async function advanceStage(
  db: Db, projectId: string, toStage: StageKind,
): Promise<Details> {
  const result = await updateDetails(db, projectId, (d) => {
    const now = new Date().toISOString();
    for (const stg of Object.values(d.stages)) {
      if (stg.status === 'active') {
        stg.status = 'done';
        if (!stg.completedAt) stg.completedAt = now;
        for (const ph of Object.values(stg.phases as Record<string, { status: string }>)) {
          if (ph.status !== 'done') ph.status = 'done';
        }
      }
    }
    let toIdx = STAGE_ORDER.indexOf(toStage);
    while (toIdx < STAGE_ORDER.length - 1 && d.stages[STAGE_ORDER[toIdx]].status === 'skipped') {
      toIdx += 1;
    }
    const resolvedStage = STAGE_ORDER[toIdx];
    const target = d.stages[resolvedStage];
    target.status = 'active';
    if (!target.startedAt) target.startedAt = now;
    // Activate the target stage's first phase so the resolver enters its branch.
    const firstPhase = STAGE_FIRST_PHASE[resolvedStage];
    const phases = target.phases as Record<string, { status: string }>;
    if (phases[firstPhase] && phases[firstPhase].status === 'pending') {
      phases[firstPhase].status = 'active';
    }
    return d;
  });
  // The denormalized currentStage/phase columns are mirrored by deriveCurrentStage
  // (the single writer), which performTransition calls after every effect.
  return result;
}

export async function advancePhase(
  db: Db, projectId: string, stageKind: StageKind, toPhase: string,
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    const phases = d.stages[stageKind].phases as Record<string, { status: string }>;
    for (const ph of Object.values(phases)) {
      if (ph.status === 'active') ph.status = 'done';
    }
    if (phases[toPhase]) phases[toPhase].status = 'active';
    return d;
  });
}

/**
 * Reopen a stage that was skipped (marked done without doing its work) — the
 * completion-invariant recovery. Resets the target stage AND every stage after it
 * to a clean pending template (so their skipped work is redone from scratch, not
 * left in a half-corrupt state), then re-activates the target at its first phase.
 * Clears `completed_at`. The driver then drives the pipeline forward again.
 */
export async function reopenStage(
  db: Db, projectId: string, toStage: StageKind,
): Promise<Details> {
  const result = await updateDetails(db, projectId, (d) =>
    reopenStageInPlace(d, toStage, new Date().toISOString()));
  // currentStage/phase are mirrored by deriveCurrentStage (single writer). Clearing
  // completedAt is this function's own concern (a reopened project is no longer done).
  await db.update(project)
    .set({ completedAt: null, updatedAt: new Date() })
    .where(eq(project.id, projectId));
  return result;
}

export async function setAutomationStatus(
  db: Db, projectId: string, status: 'off' | 'running',
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    d.automation.status = status;
    if (status === 'running') {
      // A fresh run resets only the auto-run clock. The activity timeline is
      // project-level (`project_activity`) and is NEVER cleared — it's the full
      // project timeline, independent of any single automation run.
      d.automation.startedAt = new Date().toISOString();
      d.automation.stoppedAt = undefined;
    } else {
      d.automation.stoppedAt = new Date().toISOString();
    }
    return d;
  });
}

/**
 * Save the exploration brain-dump text. This is a CONTENT edit — it does NOT
 * complete the brief phase. The phase stays `active` (so "Analyze sources" /
 * propose_discover_tasks and further edits remain available) until the human
 * advances via advance_phase ("Continue to Discover"), which marks it done.
 */
export async function setBriefText(
  db: Db, projectId: string, text: string,
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    d.stages.exploration.phases.brief.text = text;
    return d;
  });
}
