import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { allowedActions, type Action, type Mode } from '@/automation/allowed-actions';
import { repairActiveStage } from '@/automation/stage-repair';

/**
 * The single gated executor (spec §4.2). Reload details → repair the exactly-one-
 * active invariant → gate (mode rule + allowed set + lease) → run the action effect
 * → mirror currentStage. Phase 1 wires the gate; the effect + lease + mirror are
 * added in Tasks 6-7.
 */
export class TransitionRejected extends Error {
  constructor(readonly reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = 'TransitionRejected';
  }
}

export interface Trigger {
  mode: Mode;
  actorId?: string | null;
}

/** Actions that edit content within a phase — they skip the phase single-flight lease. */
const CONTENT_ACTIONS = new Set([
  'set_brief', 'select_components', 'add_attachment', 'remove_attachment', 'refine_component', 'edit_plan_task',
]);

export async function performTransition(db: Db, projectId: string, action: Action, trigger: Trigger): Promise<void> {
  const [row] = await db
    .select({ details: project.details, autoMode: project.autoMode })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row?.details) throw new TransitionRejected('no details');
  const details = validateDetails(row.details);

  // Invariant repair BEFORE anything else (spec §2).
  repairActiveStage(details);

  // GATE 4 — mode rule (AC17). take_over is the sole manual action allowed while running.
  const autoRunning = details.automation.status === 'running';
  if (trigger.mode === 'manual' && autoRunning && action.kind !== 'take_over') {
    throw new TransitionRejected('auto is driving — take over first');
  }
  if (trigger.mode === 'auto' && !autoRunning) {
    throw new TransitionRejected('auto not running');
  }

  // GATE 2 — allowed by the state machine.
  const allowed = allowedActions(details, trigger.mode);
  if (
    action.kind !== 'take_over' &&
    !allowed.some((a) => a.kind === action.kind && a.stage === action.stage && a.phase === action.phase)
  ) {
    throw new TransitionRejected(`action ${action.kind} not allowed now`);
  }

  // GATE 3 (lease) + EXECUTE + WRITE + mirror — wired in Tasks 6-7.
  const isContent = CONTENT_ACTIONS.has(action.kind);
  void isContent;
}
