import { EventEmitter } from 'node:events';

/**
 * Per-project event bus (Spec 5 §SSE / shared infra reused by Spec 7's build
 * monitor). An in-process `EventEmitter` keyed by `projectId`, with a
 * subscriber-count refcount so an empty channel is torn down (no leaked
 * emitter). The publish/subscribe surface is shaped so a Redis fan-out can swap
 * in later (multi-instance — deferred).
 */

/** The SSE `data:` payload — one discriminated union over project-scoped events. */
export type ProjectEvent =
  | {
      type: 'task.progress';
      taskId: string;
      mmaBatchId: string;
      headline: string;
      route: string;
      status: 'running';
    }
  | { type: 'task.done'; taskId: string; mmaBatchId: string; route: string; status: 'recorded' }
  | {
      type: 'task.failed';
      taskId: string;
      mmaBatchId: string;
      route: string;
      error: { code: string; message: string };
    }
  | { type: 'synthesis.updated'; artifactId: string; version: number }
  // ── Spec 7 build-monitor events (all project-scoped) ──────────────────────
  | {
      type: 'plan.authored';
      tasks: Array<{ id: string; title: string; repo: string; reviewPolicy: string }>;
      writeTargets: string[];
      readOnly: string[];
    }
  | { type: 'plan.failed'; reason: string }
  | { type: 'audit.pass'; repo: string; pass: number; findingsCount: number; verdict: 'revised' | 'clean' }
  | { type: 'task.executing'; taskId: string; repo: string; branch: string; title: string }
  | { type: 'task.verifying'; taskId: string }
  | { type: 'task.fixing'; taskId: string; note: string }
  | { type: 'task.fixed'; taskId: string; note: string }
  | { type: 'task.committed'; taskId: string; commitSha: string }
  | { type: 'build.task_failed'; taskId: string; reason: string }
  | { type: 'review.done'; repo: string; verdict: 'approved' | 'changes_required' | 'error'; findingsCount: number }
  | { type: 'execute.notice'; memberId: string; repo: string }
  | {
      type: 'cost.tick';
      runCostUsd: number;
      byRoute: { audit: number; executePlan: number; review: number };
    }
  | { type: 'heartbeat'; t: number }
  // ── Universal dispatch events (handler-based, all routes) ────────────────
  | { type: 'dispatch.progress'; batchId: string; handler: string; phase: string; elapsedMs: number; totalTasks?: number; repoId?: string }
  | { type: 'dispatch.done'; batchId: string; handler: string; repoId?: string }
  | { type: 'dispatch.failed'; batchId: string; handler: string; error: string; repoId?: string }
  // ── Stage-level sync events (multi-user real-time) ────────────────────
  | { type: 'spec.updated' }
  | { type: 'plan.updated'; taskId: string; chatReply: string; updated: boolean }
  | { type: 'chat.message'; componentId: string; message: { id: string; sender: 'forge' | 'member'; authorId: string; authorName: string; bodyMd: string } }
  | { type: 'chat.typing'; componentId: string; typing: boolean }
  // ── Automation events ────────────────────────────────────────────
  | { type: 'automation.progress'; note: string; stage?: string; phase?: string }
  | { type: 'automation.step_done'; step: string; stage?: string; phase?: string; stepIndex?: number }
  | { type: 'automation.navigate'; url: string }
  | { type: 'automation.error'; error: string };

const EVENT = 'event';

/**
 * The supported per-project concurrent-viewer ceiling. Node warns past 10
 * listeners; we raise it to 100 so legitimate fan-out (a single team viewing a
 * project) never trips `MaxListenersExceededWarning`, while a runaway leak past
 * 100 still surfaces it.
 */
export const MAX_SUBSCRIBERS_PER_PROJECT = 100;

export type Subscriber = (e: ProjectEvent) => void;

export class ProjectEventBus {
  private readonly channels = new Map<string, EventEmitter>();

  /** Subscribe to a project's events; returns an unsubscribe fn that refcounts. */
  subscribe(projectId: string, fn: Subscriber): () => void {
    let emitter = this.channels.get(projectId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(MAX_SUBSCRIBERS_PER_PROJECT);
      this.channels.set(projectId, emitter);
    }
    const handler = (e: ProjectEvent) => fn(e);
    emitter.on(EVENT, handler);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const ch = this.channels.get(projectId);
      if (!ch) return;
      ch.off(EVENT, handler);
      // Refcount teardown: when the last subscriber leaves, drop the channel
      // entirely so the Map never leaks dead emitters.
      if (ch.listenerCount(EVENT) === 0) {
        this.channels.delete(projectId);
      }
    };
  }

  /** Publish an event to every subscriber of a project. No-op if no channel. */
  publish(projectId: string, event: ProjectEvent): void {
    const ch = this.channels.get(projectId);
    if (!ch) return;
    ch.emit(EVENT, event);
  }

  /** Current subscriber count for a project (0 if no channel). Test/diagnostics. */
  subscriberCount(projectId: string): number {
    return this.channels.get(projectId)?.listenerCount(EVENT) ?? 0;
  }

  /** Whether a channel currently exists (refcount > 0). Test/diagnostics. */
  hasChannel(projectId: string): boolean {
    return this.channels.has(projectId);
  }

  channelCount(): number {
    return this.channels.size;
  }
}

/** Process-wide singleton bus — force new instance to pick up method changes. */
const g = globalThis as unknown as { __forgeEventBus?: ProjectEventBus; __forgeEventBusV?: number };
const BUS_VERSION = 3;
if (!g.__forgeEventBus || g.__forgeEventBusV !== BUS_VERSION) {
  g.__forgeEventBus = new ProjectEventBus();
  g.__forgeEventBusV = BUS_VERSION;
}
export const projectEventBus = g.__forgeEventBus;
