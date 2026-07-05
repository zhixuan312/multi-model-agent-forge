import { eq, and } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails, type Details } from '@/details/schema';
import { resolveRunningEventInPlace, reopenStageInPlace, STAGE_FIRST_PHASE } from '@/automation/details-mutations';
import { STAGE_ORDER, type StageKind } from '@/db/enums';

export class DetailsVersionConflict extends Error {
  constructor(projectId: string) {
    super(`Optimistic lock failed for project ${projectId} after 3 retries`);
    this.name = 'DetailsVersionConflict';
  }
}

export async function updateDetails(
  db: Db,
  projectId: string,
  mutator: (d: Details) => Details,
): Promise<Details> {
  for (let attempt = 0; attempt < 3; attempt++) {
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
  throw new DetailsVersionConflict(projectId);
}

/** Design (exploration·spec·plan) → build (execute·review) → learn (journal). */
const STAGE_PHASE: Record<StageKind, 'design' | 'build' | 'learn'> = {
  exploration: 'design', spec: 'design', plan: 'design',
  execute: 'build', review: 'build', journal: 'learn',
};

/**
 * The single writer of the denormalized `currentStage`/`phase` columns (spec §4.4,
 * AC8): mirror them from the one active stage in `details`. Called by
 * `performTransition` after every effect, so the columns can never drift. (The
 * pre-existing direct writes in advanceStage/reopenStage are removed in Task 11.)
 */
export async function deriveCurrentStage(db: Db, projectId: string): Promise<void> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return;
  const d = validateDetails(row.details);
  const active = STAGE_ORDER.find((k) => d.stages[k].status === 'active');
  if (!active) return;
  await db.update(project).set({ currentStage: active, phase: STAGE_PHASE[active], updatedAt: new Date() }).where(eq(project.id, projectId));
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
    const target = d.stages[toStage];
    target.status = 'active';
    if (!target.startedAt) target.startedAt = now;
    // Activate the target stage's first phase so the resolver enters its branch.
    const firstPhase = STAGE_FIRST_PHASE[toStage];
    const phases = target.phases as Record<string, { status: string }>;
    if (phases[firstPhase] && phases[firstPhase].status === 'pending') {
      phases[firstPhase].status = 'active';
    }
    return d;
  });
  // Keep the denormalized columns in sync — the stepper/topbar read these, and
  // automation never visits pages so nothing else would update them.
  await db.update(project)
    .set({ currentStage: toStage, phase: STAGE_PHASE[toStage], updatedAt: new Date() })
    .where(eq(project.id, projectId));
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
  await db.update(project)
    .set({ currentStage: toStage, phase: STAGE_PHASE[toStage], completedAt: null, updatedAt: new Date() })
    .where(eq(project.id, projectId));
  return result;
}

export async function setAutomationStatus(
  db: Db, projectId: string, status: 'off' | 'running',
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    d.automation.status = status;
    if (status === 'running') {
      // A fresh run resets only the auto-run clock. The event log is project-level
      // (`details.events`) and is NEVER cleared — it's the full project timeline.
      d.automation.startedAt = new Date().toISOString();
      d.automation.stoppedAt = undefined;
    } else {
      d.automation.stoppedAt = new Date().toISOString();
    }
    return d;
  });
}

/**
 * Append one line to the project-level event log (`details.events`) — the single
 * writer for the full activity timeline across every stage and both triggers
 * (manual UI + auto driver). De-dupes a line identical to the immediately previous
 * one (e.g. a poll loop). Best-effort: never throws into the caller.
 */
export async function appendProjectEvent(
  db: Db, projectId: string,
  event: { stage: string; phase: string; detail: string; kind?: 'action' | 'error' | 'done'; durationMs?: number },
): Promise<void> {
  try {
    await updateDetails(db, projectId, (d) => {
      const last = d.events[d.events.length - 1];
      if (last && last.detail === event.detail && (last.kind ?? 'action') === (event.kind ?? 'action')) return d;
      d.events.push({ stage: event.stage, phase: event.phase, detail: event.detail, kind: event.kind ?? 'action', durationMs: event.durationMs, at: new Date().toISOString() });
      return d;
    });
  } catch { /* the durable log is best-effort — never block the caller */ }
}

/**
 * Resolve the current `running` activity line to a terminal state (`done`/`error`),
 * IN PLACE, with the real work duration — so each activity is ONE line that ticks
 * live while running and lands settled with its measured time (no start/finish
 * pair). Finds the most-recent unresolved `action` line for `stage` and finalizes
 * it. If none exists (e.g. a manual dispatch the driver never announced), appends a
 * fresh terminal line instead. Best-effort: never throws into the caller. RETURNS
 * the resolved detail (with any preserved pass number) so callers publish the exact
 * same label live over SSE.
 */
export async function resolveRunningEvent(
  db: Db, projectId: string,
  opts: { stage: string; phase: string; detail: string; kind?: 'done' | 'error'; durationMs?: number },
): Promise<string> {
  let resolved = opts.detail;
  try {
    await updateDetails(db, projectId, (d) => {
      resolved = resolveRunningEventInPlace(d, { ...opts, at: new Date().toISOString() });
      return d;
    });
  } catch { /* the durable log is best-effort — never block the caller */ }
  return resolved;
}

export async function setBriefText(
  db: Db, projectId: string, text: string,
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    d.stages.exploration.phases.brief.text = text;
    d.stages.exploration.phases.brief.status = 'done';
    return d;
  });
}
