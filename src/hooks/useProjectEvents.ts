'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ProjectEvent } from '@/sse/event-bus';

/**
 * `useProjectEvents(projectId)` (Spec 5 §SSE) — a client island that opens one
 * `EventSource` to `/api/projects/[id]/events` and patches the TanStack Query
 * cache on each message, so the agent rail + summary update live with NO
 * browser→MMA polling. The DB is the source of truth; SSE is a fast-path:
 * on reconnect we invalidate the task list to reconcile anything missed.
 *
 * Opened by `projects/[id]/layout` and shared by every island in the shell
 * (Spec 7's build monitor reuses the same hook/stream).
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
      break;
    }
    case 'task.done': {
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
      patchTask(qc, projectId, e.taskId, (t) => ({
        ...t,
        status: 'recorded',
        batchStatus: 'failed',
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
    case 'heartbeat':
      break;
  }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, qc]);
}
