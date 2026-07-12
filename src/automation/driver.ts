import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { projectEventBus } from '@/sse/event-bus';
import { isBatchBackedAction } from '@/automation/details-actions';
import { performTransition, TransitionRejected } from '@/automation/perform-transition';
import { allowedActions } from '@/automation/allowed-actions';
import { recordActivity } from '@/activity/project-activity';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { acquireDriverLease, startLeaseHeartbeat, releaseDriverLease } from '@/automation/driver-lease';

const activeDrivers = new Map<string, boolean>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Turn a resolver note ("Running spec audit pass 1...") into a clean log label. */
function cleanLabel(note: string): string {
  return note.replace(/\.\.\.$/, '').trim();
}

// Exported so the cutover test can assert it writes through recordActivity (project_activity)
// and never touches the legacy details.events helpers. Its live caller is driveProject below.
export async function recordDriverOnlyLine(
  db: ReturnType<typeof getDb>,
  projectId: string,
  stage: string,
  phase: string,
  label: string,
  kind: 'done' | 'error',
): Promise<void> {
  await recordActivity({
    db,
    projectId,
    stage,
    phase,
    label,
    kind,
    actor: { id: FORGE_MEMBER_ID, name: 'Forge', tint: '#9a6b4f' },
    source: 'mma',
  });
  projectEventBus.publish(projectId, { type: 'automation.progress', note: label, stage, phase, kind });
}

export async function driveProject(projectId: string): Promise<void> {
  if (activeDrivers.get(projectId)) return; // fast in-process dedup
  activeDrivers.set(projectId, true);
  const db = getDb();

  // G1 — acquire the DB-backed single-driver lease. If another (live) driver holds
  // it (a boot-resume or a not-yet-exited driver on another process/module
  // instance), DO NOT drive: two drivers racing the shared details is what lets
  // stages advance "in the mess". Stale leases self-heal (heartbeat timeout).
  const driverId = randomUUID();
  if (!(await acquireDriverLease(db, projectId, driverId).catch(() => false))) {
    activeDrivers.delete(projectId);
    return;
  }

  // Keep the lease fresh on a BACKGROUND timer, decoupled from the loop body — the
  // loop blocks for minutes inside a single MMA dispatch, so a loop-top-only
  // heartbeat would go stale mid-call and let another driver steal the lease.
  let leaseLost = false;
  const stopHeartbeat = startLeaseHeartbeat(db, projectId, driverId, () => {
    leaseLost = true;
  });

  // emit() now publishes SSE only; it must not write durable rows.
  const emit = async (label: string, kind: 'action' | 'error' | 'done', stage: string, phase: string) => {
    projectEventBus.publish(projectId, { type: 'automation.progress', note: label, stage, phase, kind });
  };

  try {
    while (true) {
      // The background heartbeat owns lease refresh; here we only check whether it
      // reported a takeover. If another driver took over, STOP — only the holder drives.
      if (leaseLost) return;

      const [proj] = await db
        .select({ autoMode: project.autoMode, detailsReady: project.detailsReady, details: project.details })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1);
      if (!proj?.autoMode) return;

      const { validateDetails } = await import('@/details/schema');
      if (!proj.details) { await sleep(5000); continue; }
      // Centralized reconcile for EVERY async-dispatched attempt (plan-author,
      // execute, …) before resolving, so a WAITing resolver doesn't deadlock on a
      // `running` attempt whose terminal handler never closed it (handlers only run
      // on success). A flip emits an error line (surfacing the failure) → retry.
      const { reconcileStuckAttempts } = await import('@/automation/details-actions');
      await reconcileStuckAttempts(db, projectId).catch(() => {});
      const [proj2] = await db
        .select({ details: project.details })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1);
      const details = validateDetails(proj2?.details ?? proj.details);
      // The unified engine: the driver takes the single best-practice action from the
      // permitted set. An empty set = WAIT (nothing allowed now, e.g. MMA in flight).
      const [action] = allowedActions(details, 'auto');
      if (!action) { await sleep(5000); continue; }

      if (action.kind === 'complete') {
        await recordDriverOnlyLine(db, projectId, '', '', 'All stages complete — project finished', 'done');
        projectEventBus.publish(projectId, { type: 'automation.step_done', step: action.kind });
        await db.update(project).set({ autoMode: false, autoNote: 'Project complete' }).where(eq(project.id, projectId));
        return;
      }

      // SINGLE-FLIGHT GUARD (DB-authoritative): the pipeline is strictly sequential,
      // so NEVER dispatch OR advance while ANY MMA request is in flight for this
      // project. Prevents a stray/duplicate writer (e.g. a boot-resumed driver
      // overlapping a reset) from advancing stages or firing a second concurrent
      // MMA call while work is in flight. The in-flight batch will terminal + record
      // its state, then the resolver re-resolves from the settled state.
      const { findInflight } = await import('@/dispatch/dispatch-helpers');
      if (await findInflight(db, projectId) !== null) { await sleep(5000); continue; }

      // The one meaningful line: what Forge is doing now.
      await emit(cleanLabel(action.note), 'action', action.stage, action.phase);
      await db.update(project).set({ autoNote: action.note, updatedAt: new Date() }).where(eq(project.id, projectId));

      let lastErr: string | null = null;
      let result: 'ok' | 'inflight' = 'ok';
      const { PhaseBusyError } = await import('@/dispatch/dispatch-helpers');
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await performTransition(db, projectId, action, { mode: 'auto', actorId: driverId });
          result = 'ok';
          lastErr = null;
          break;
        } catch (err) {
          // A refused transition (cross-phase G2, or the gate said busy/not-allowed)
          // → WAIT (don't burn retries/stop auto); the in-flight phase settles and the
          // driver re-resolves. Only a real effect error retries/stops.
          if (err instanceof PhaseBusyError || err instanceof TransitionRejected) { result = 'inflight'; lastErr = null; break; }
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt < 3) {
            await emit(`Retry ${attempt}/3 — ${lastErr}`, 'error', action.stage, action.phase);
            await db.update(project).set({ autoNote: `${action.note} (retry ${attempt}/3)`, updatedAt: new Date() }).where(eq(project.id, projectId));
            await sleep(5000 * attempt);
          }
        }
      }

      // ops_mma_batch is the source of truth: an in-flight batch for this handler
      // means "already dispatched/running" → WAIT, don't re-fire.
      if (result === 'inflight') { await sleep(5000); continue; }

      if (lastErr) {
        await recordDriverOnlyLine(db, projectId, action.stage, action.phase, `Failed — ${lastErr}`, 'error');
        await db.update(project).set({ autoMode: false, autoNote: `Failed after 3 attempts: ${lastErr}`, updatedAt: new Date() }).where(eq(project.id, projectId));
        projectEventBus.publish(projectId, { type: 'automation.error', error: lastErr });
        return;
      }

      // Non-batch actions (approvals, advances, mark-complete) have no MMA terminal
      // to settle their running line — finalize it here so it lands as a done
      // milestone. Batch-backed actions leave the line running; their batch terminal
      // resolves it in place with the measured duration.
      if (!isBatchBackedAction(action.kind)) {
        await recordDriverOnlyLine(db, projectId, action.stage, action.phase, cleanLabel(action.note), 'done');
      }

      // Success — nudge the client to re-pull server state (stepper/summary).
      if (!action.kind.startsWith('navigate_')) {
        projectEventBus.publish(projectId, { type: 'automation.step_done', step: action.kind, stage: action.stage, phase: action.phase });
      }

      await sleep(1000);
    }
  } finally {
    stopHeartbeat();
    activeDrivers.delete(projectId);
    await releaseDriverLease(db, projectId, driverId).catch(() => {});
  }
}

export function isDriverRunning(projectId: string): boolean {
  return activeDrivers.get(projectId) ?? false;
}
