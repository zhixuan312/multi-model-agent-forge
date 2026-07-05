import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { projectEventBus } from '@/sse/event-bus';
import { executeDetailsAction, isBatchBackedAction } from '@/automation/details-actions';
import { appendProjectEvent, resolveRunningEvent } from '@/details/write';

const activeDrivers = new Map<string, boolean>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Turn a resolver note ("Running spec audit pass 1...") into a clean log label. */
function cleanLabel(note: string): string {
  return note.replace(/\.\.\.$/, '').trim();
}

export async function driveProject(projectId: string): Promise<void> {
  if (activeDrivers.get(projectId)) return;
  activeDrivers.set(projectId, true);
  const db = getDb();

  // One persisted, meaningful line per action, appended to the project-level event
  // log (`details.events`). The SAME record drives the live SSE stream AND the
  // durable log, so a refresh shows exactly what was live. Decorative/transient
  // lines (location, "dispatching", "waiting", a redundant "done") are gone: the
  // running action line's spinner + ticking duration already conveys "in progress".
  const emit = async (label: string, kind: 'action' | 'error' | 'done', stage: string, phase: string) => {
    await appendProjectEvent(db, projectId, { stage, phase, detail: label, kind });
    projectEventBus.publish(projectId, { type: 'automation.progress', note: label, stage, phase, kind });
  };

  try {
    while (true) {
      const [proj] = await db
        .select({ autoMode: project.autoMode, detailsReady: project.detailsReady, details: project.details })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1);
      if (!proj?.autoMode) return;

      const { validateDetails } = await import('@/details/schema');
      const { resolveNextActionFromDetails } = await import('@/automation/details-resolver');
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
      const action = resolveNextActionFromDetails(details);

      if (action.kind === 'complete') {
        await emit('All stages complete — project finished', 'done', '', '');
        projectEventBus.publish(projectId, { type: 'automation.step_done', step: action.kind });
        await db.update(project).set({ autoMode: false, autoNote: 'Project complete' }).where(eq(project.id, projectId));
        return;
      }

      // WAIT / already-in-flight: emit nothing — the current action line keeps
      // spinning and its duration ticks until the running task terminates.
      if (action.kind === 'wait') { await sleep(5000); continue; }

      // The one meaningful line: what Forge is doing now.
      await emit(cleanLabel(action.note), 'action', action.stage, action.phase);
      await db.update(project).set({ autoNote: action.note, updatedAt: new Date() }).where(eq(project.id, projectId));

      let lastErr: string | null = null;
      let result: 'ok' | 'inflight' = 'ok';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          result = await executeDetailsAction(projectId, action, db);
          lastErr = null;
          break;
        } catch (err) {
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
        // Resolve the running line to a failed state in place (one line per activity).
        await resolveRunningEvent(db, projectId, { stage: action.stage, phase: action.phase, detail: `Failed — ${lastErr}`, kind: 'error' });
        await db.update(project).set({ autoMode: false, autoNote: `Failed after 3 attempts: ${lastErr}`, updatedAt: new Date() }).where(eq(project.id, projectId));
        projectEventBus.publish(projectId, { type: 'automation.progress', note: `Failed — ${lastErr}`, stage: action.stage, phase: action.phase, kind: 'error' });
        projectEventBus.publish(projectId, { type: 'automation.error', error: lastErr });
        return;
      }

      // Non-batch actions (approvals, advances, mark-complete) have no MMA terminal
      // to settle their running line — finalize it here so it lands as a done
      // milestone. Batch-backed actions leave the line running; their batch terminal
      // resolves it in place with the measured duration.
      if (!isBatchBackedAction(action.kind)) {
        await resolveRunningEvent(db, projectId, { stage: action.stage, phase: action.phase, detail: cleanLabel(action.note), kind: 'done' });
        projectEventBus.publish(projectId, { type: 'automation.progress', note: cleanLabel(action.note), stage: action.stage, phase: action.phase, kind: 'done' });
      }

      // Success — nudge the client to re-pull server state (stepper/summary).
      if (!action.kind.startsWith('navigate_')) {
        projectEventBus.publish(projectId, { type: 'automation.step_done', step: action.kind, stage: action.stage, phase: action.phase });
      }

      await sleep(1000);
    }
  } finally {
    activeDrivers.delete(projectId);
  }
}

export function isDriverRunning(projectId: string): boolean {
  return activeDrivers.get(projectId) ?? false;
}
