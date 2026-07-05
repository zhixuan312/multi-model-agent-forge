import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { allowedActions, type Action, type Mode } from '@/automation/allowed-actions';
import { repairActiveStage } from '@/automation/stage-repair';
import { executeDetailsAction } from '@/automation/details-actions';
import { deriveCurrentStage } from '@/details/write';
import { DRIVER_LEASE_STALE_MS } from '@/automation/driver-lease';

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
const CONTENT_ACTIONS = new Set(['set_brief', 'select_components']);

/**
 * True iff the lease is held by a DIFFERENT actor AND still fresh (heartbeat within
 * DRIVER_LEASE_STALE_MS). That's the single-flight signal: another driver/transition
 * is genuinely in flight. A stale foreign lease (crashed holder) is NOT fresh → the
 * new transition may proceed (self-heal, AC10). One's own lease is never "foreign".
 */
export function isForeignLeaseFresh(
  automation: { driverId?: string; driverHeartbeatAt?: string },
  actorId: string | null | undefined,
): boolean {
  const holder = automation.driverId;
  if (!holder || holder === actorId) return false;
  const hb = automation.driverHeartbeatAt;
  if (!hb) return false;
  return Date.now() - new Date(hb).getTime() < DRIVER_LEASE_STALE_MS;
}

/**
 * What a caller supplies: the action KIND (+ optional payload). The full Action
 * (stage/phase/note) is resolved INTERNALLY from `allowedActions` — so a client (the
 * `/transition` route) never pre-gates or invents stage/phase, and `performTransition`
 * stays the single gate + resolver. The driver may pass a full Action (a superset).
 */
export interface ActionInput {
  kind: string;
  data?: Record<string, unknown>;
}

export async function performTransition(db: Db, projectId: string, input: ActionInput, trigger: Trigger): Promise<void> {
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
  if (trigger.mode === 'manual' && autoRunning && input.kind !== 'take_over') {
    throw new TransitionRejected('auto is driving — take over first');
  }
  if (trigger.mode === 'auto' && !autoRunning) {
    throw new TransitionRejected('auto not running');
  }

  // GATE 2 — allowed by the state machine. Resolve the FULL action from the permitted
  // set by kind (the single resolver), merging the caller's payload.
  const allowed = allowedActions(details, trigger.mode);
  const match = allowed.find((a) => a.kind === input.kind);
  if (!match) {
    throw new TransitionRejected(`action ${input.kind} not allowed now`);
  }
  // Thread the human's member id into the effect payload for MANUAL touches, so
  // Design-phase effects attribute approvals/dispatches to the actual actor (auto
  // touches carry a driverId, not a member id, and their effects use FORGE_MEMBER_ID).
  const action: Action = {
    ...match,
    data: {
      ...(match.data ?? {}),
      ...(input.data ?? {}),
      ...(trigger.mode === 'manual' && trigger.actorId ? { actorId: trigger.actorId } : {}),
    },
  };

  // GATE 3 — single-flight lease. Advancing / MMA-dispatching actions are rejected
  // while a FRESH FOREIGN lease is held (another driver/transition in flight). The
  // auto driver holds a persistent lease + heartbeat (driveProject), so a second
  // driver hits this and waits. Content actions skip it (spec §4.5) — they never
  // serialize on the phase lease. Stale foreign leases self-heal (AC10).
  const isContent = CONTENT_ACTIONS.has(action.kind);
  if (!isContent && action.kind !== 'take_over' && isForeignLeaseFresh(details.automation, trigger.actorId)) {
    throw new TransitionRejected('busy — another transition is in flight');
  }

  // EXECUTE the action's effect (the single implementation — today's
  // executeDetailsAction switch; extended for Design/content actions in Tasks 8b/10).
  await executeDetailsAction(projectId, action, db);

  // WRITE mirror — derive currentStage/phase from the (now-updated) active stage.
  await deriveCurrentStage(db, projectId);
}
