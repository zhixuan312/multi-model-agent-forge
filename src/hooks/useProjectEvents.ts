'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ProjectEvent } from '@/sse/event-bus';
import { CANCELLING_HEADLINE } from '@/sse/cancel-phase';

/**
 * `useProjectEvents(projectId)` (Spec 5 §SSE) — opens an `EventSource` to
 * `/api/projects/[id]/events` and patches the TanStack Query cache on each message, so
 * the agent rail + summary update live with NO browser→MMA polling. The DB is the source
 * of truth; SSE is a fast-path: on reconnect we invalidate the task list to reconcile
 * anything missed.
 *
 * NOT one connection per page. This header used to claim the layout opened a single
 * stream "shared by every island in the shell"; neither half was true. It is called by
 * `AutomationOverlay` and `ExploreStageClient`, never by the layout, and `useMmaDispatch`
 * opens its OWN EventSource to the same URL — so the Explore page holds three. That is
 * deliberate for now: each connection costs one in-memory bus subscriber and a 15s
 * heartbeat on the server (see the events route), the two hooks consume disjoint event
 * families, and collapsing them means a shared provider around the whole shell. Written
 * down rather than implied, so the cost is a choice instead of a surprise.
 *
 * The switch below is deliberately PARTIAL: `spec.updated`/`plan.*`/`chat.message` reach
 * components through `useMmaDispatch`'s `events` option. Missing a case here is not
 * necessarily a gap. The exception is `dispatch.*`, which otherwise belongs to that hook:
 * the cancellation half is bridged here because the overlay — which has no per-stage rail —
 * is what needs to know when a Stop has actually taken effect.
 */

/** Query-key conventions for the project-scoped live data. */
export const explorationKeys = {
  tasks: (projectId: string) => ['exploration', projectId, 'tasks'] as const,
  artifact: (projectId: string) => ['exploration', projectId, 'artifact'] as const,
};

/** A task row as held in the rail's query cache (mirror of the DTO). */
export interface RailTask {
  id: string;
  kind: string;
  status: string;
  prompt: string;
  targetRepoId: string | null;
  mmaBatchId: string | null;
  /** Joined from mma_batch — the live status/headline/error. */
  batchStatus: string | null;
  headline: string | null;
  error: { code: string; message: string } | null;
  outputMd: string | null;
}

export interface ArtifactCacheEntry {
  id: string;
  version: number;
  bodyMd: string;
}

/**
 * Apply one event to the TanStack cache. Pure of EventSource so it's unit-tested
 * directly. Patches the task list for `task.*` and the artifact entry for
 * `synthesis.updated`; `heartbeat` is a no-op.
 */
export function applyProjectEvent(qc: QueryClient, projectId: string, e: ProjectEvent): void {
  switch (e.type) {
    case 'task.progress': {
      patchTask(qc, projectId, e.taskId, (t) => ({
        ...t,
        status: 'running',
        batchStatus: 'running',
        headline: e.headline,
      }));
      // A Stop cancels EVERY in-flight batch for the project, and `PollManager` announces
      // the request on two different events: `dispatch.progress` for handler-backed work,
      // and this one for task-backed work (exploration discover tasks). Only the handler
      // half was bridged, so a project whose in-flight work was task-backed produced no
      // acknowledgement at all. The overlay's `sawPending` stayed false, its bail timer
      // fired, and the overlay closed while the engine was still winding those tasks down.
      if (e.headline === CANCELLING_HEADLINE) {
        window.dispatchEvent(new CustomEvent('automation:cancelling', { detail: { batchId: e.mmaBatchId } }));
      }
      break;
    }
    case 'task.done': {
      settleStop(e.mmaBatchId);
      patchTask(qc, projectId, e.taskId, (t) => ({
        ...t,
        status: 'recorded',
        batchStatus: 'done',
      }));
      // The event carries only status, not the findings. Refetch the tasks so the
      // joined `outputMd` loads NOW (per task) — otherwise the task shows
      // `recorded` with a blank "No output available" pane until some later refetch
      // (e.g. the whole phase completing) fills it in.
      void qc.invalidateQueries({ queryKey: explorationKeys.tasks(projectId) });
      break;
    }
    case 'task.failed': {
      settleStop(e.mmaBatchId);
      patchTask(qc, projectId, e.taskId, (t) => ({
        ...t,
        status: 'recorded',
        batchStatus: 'failed',
        error: e.error,
      }));
      void qc.invalidateQueries({ queryKey: explorationKeys.tasks(projectId) });
      break;
    }
    // Terminal like task.failed, but the batch status stays `cancelled` so the rail can
    // tell a deliberate stop from a fault. Without this the task would sit at `running`
    // forever — the cancelled terminal never emits task.failed.
    case 'task.cancelled': {
      settleStop(e.mmaBatchId);
      patchTask(qc, projectId, e.taskId, (t) => ({
        ...t,
        status: 'recorded',
        batchStatus: 'cancelled',
        error: e.error,
      }));
      void qc.invalidateQueries({ queryKey: explorationKeys.tasks(projectId) });
      break;
    }
    case 'synthesis.updated': {
      qc.setQueryData<ArtifactCacheEntry | undefined>(
        explorationKeys.artifact(projectId),
        (prev) => ({
          id: e.artifactId,
          version: e.version,
          bodyMd: prev?.bodyMd ?? '',
        }),
      );
      // The body itself is refetched authoritatively; bump triggers an invalidate.
      void qc.invalidateQueries({ queryKey: explorationKeys.artifact(projectId) });
      break;
    }
    case 'automation.progress':
      window.dispatchEvent(new CustomEvent('automation:progress', { detail: { note: e.note, stage: e.stage, phase: e.phase, kind: e.kind, durationMs: e.durationMs } }));
      break;
    case 'automation.step_done':
      window.dispatchEvent(new CustomEvent('automation:step_done', { detail: { step: e.step, stage: e.stage, phase: e.phase, stepIndex: e.stepIndex } }));
      break;
    case 'automation.error':
      window.dispatchEvent(new CustomEvent('automation:error', { detail: { error: e.error } }));
      break;

    /**
     * The `dispatch.*` family belongs to `useMmaDispatch` for its per-stage rails. These two
     * cases are the ONE thing the overlay needs from it: whether the work a Stop asked to
     * cancel has actually wound down.
     *
     * Cancellation is cooperative, so `take_over` returning 200 means "asked", not "stopped".
     * `PollManager` already publishes both halves — a `cancelling` phase when the request
     * lands, and a terminal when the batch really ends — and nothing consumed either, which
     * is why Stop could only ever hide the overlay and hope.
     */
    case 'dispatch.progress':
      if (e.phase === CANCELLING_HEADLINE) {
        window.dispatchEvent(new CustomEvent('automation:cancelling', { detail: { batchId: e.batchId } }));
      }
      break;
    case 'dispatch.done':
    case 'dispatch.failed':
    case 'dispatch.cancelled':
      window.dispatchEvent(new CustomEvent('automation:dispatch_settled', { detail: { batchId: e.batchId } }));
      break;

    case 'heartbeat':
      break;
  }
}

/**
 * Tell the overlay that a batch it is waiting on has finished winding down.
 *
 * Required as the second half of the task-backed cancel bridge. The overlay keeps a set of
 * acknowledged stops and closes only when the set empties. Announcing a task-backed
 * `cancelling` without announcing its terminal would replace an overlay that closes too
 * early with one that never closes at all.
 *
 * Emitted on every task terminal, not only `task.cancelled`: a batch that finished normally
 * a moment after the Stop request is just as settled, and the engine reports that as
 * `task.done`.
 */
function settleStop(mmaBatchId: string): void {
  window.dispatchEvent(new CustomEvent('automation:dispatch_settled', { detail: { batchId: mmaBatchId } }));
}

function patchTask(
  qc: QueryClient,
  projectId: string,
  taskId: string,
  fn: (t: RailTask) => RailTask,
): void {
  qc.setQueryData<RailTask[] | undefined>(explorationKeys.tasks(projectId), (prev) => {
    if (!prev) return prev;
    return prev.map((t) => (t.id === taskId ? fn(t) : t));
  });
}

/**
 * Reconcile on (re)connect: invalidate BOTH live query caches (task list + synthesis artifact) so
 * anything missed while the stream was down re-seeds from the DB. RSC-derived stage state (spec
 * components, review passes, plan tasks, approvals) is reconciled separately by the hook's
 * `router.refresh()` on a true reconnect — those aren't in the query cache.
 */
export function reconcileOnReconnect(qc: QueryClient, projectId: string): void {
  void qc.invalidateQueries({ queryKey: explorationKeys.tasks(projectId) });
  void qc.invalidateQueries({ queryKey: explorationKeys.artifact(projectId) });
}

/**
 * Open the EventSource and wire it to the cache. The `EventSource` constructor is
 * injectable for tests (jsdom has no native EventSource).
 */
export function useProjectEvents(
  projectId: string,
  opts?: { eventSourceFactory?: (url: string) => EventSource },
): void {
  const qc = useQueryClient();
  const router = useRouter();
  // First `onopen` is the initial connect (RSC + queries just loaded fresh — nothing to reconcile);
  // every SUBSEQUENT `onopen` is a RE-connect after a dropped stream, where events may have been
  // missed. Only those trigger a full reconcile + RSC refresh.
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (!projectId) return;
    const url = `/api/projects/${projectId}/events`;
    const factory =
      opts?.eventSourceFactory ?? ((u: string) => new EventSource(u));
    const es = factory(url);

    es.onmessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as ProjectEvent;
        applyProjectEvent(qc, projectId, data);
      } catch {
        /* ignore malformed frames */
      }
    };
    // EventSource auto-reconnects on drop; `onopen` fires on each (re)connect.
    es.onopen = () => {
      if (!connectedOnce.current) {
        connectedOnce.current = true;
        return; // initial connect — state is already fresh
      }
      reconcileOnReconnect(qc, projectId);
      // Reconcile server-rendered stage state (spec/plan/review/approvals) that live events patch
      // via router.refresh — the query-cache invalidate above doesn't cover RSC-derived props.
      router.refresh();
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one SSE connection per project; `router` is stable in Next and adding it would tear the stream down and reopen it
  }, [projectId, qc]);
}
