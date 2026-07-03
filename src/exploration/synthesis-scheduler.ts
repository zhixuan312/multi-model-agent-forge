import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { ProjectEventBus, projectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { validateDetails } from '@/details/schema';
import { buildSynthesizeRequest } from '@/exploration/synthesize';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { readExplorationSummary } from '@/projects/project-files';
import '@/dispatch/handler-registry';

/**
 * `SynthesisScheduler` — watches terminal task events and debounces
 * re-synthesis via MMA dispatch. After a 5s quiet window with no new
 * terminal record, dispatches synthesis through the standard async path.
 */

const SYNTHESIS_DEBOUNCE_MS = 5_000;

export interface SchedulerDeps {
  db?: Db;
  bus?: ProjectEventBus;
  debounceMs?: number;
}

export class SynthesisScheduler {
  private readonly db: Db;
  private readonly bus: ProjectEventBus;
  private readonly debounceMs: number;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscribed = new Set<string>();

  constructor(deps: SchedulerDeps = {}) {
    this.db = deps.db ?? getDb();
    this.bus = deps.bus ?? projectEventBus;
    this.debounceMs = deps.debounceMs ?? SYNTHESIS_DEBOUNCE_MS;
  }

  watch(projectId: string): void {
    if (this.subscribed.has(projectId)) return;
    this.subscribed.add(projectId);
    this.bus.subscribe(projectId, (e: ProjectEvent) => {
      if (e.type === 'task.done' || e.type === 'task.failed') {
        this.bump(projectId);
      }
    });
  }

  bump(projectId: string): void {
    const existing = this.timers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(projectId);
      void this.dispatchSynthesis(projectId);
    }, this.debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(projectId, timer);
  }

  isArmed(projectId: string): boolean {
    return this.timers.has(projectId);
  }

  async flush(projectId: string): Promise<void> {
    const existing = this.timers.get(projectId);
    if (existing) clearTimeout(existing);
    this.timers.delete(projectId);
    await this.dispatchSynthesis(projectId);
  }

  async reconcileOnBoot(): Promise<string[]> {
    const detailsProjects = await this.db
      .select({ id: project.id, details: project.details })
      .from(project)
      .where(eq(project.detailsReady, true));

    const swept: string[] = [];
    for (const p of detailsProjects) {
      if (!p.details) continue;
      const d = validateDetails(p.details);
      const tasks = d.stages.exploration.phases.discover.tasks;
      if (tasks.length > 0 && tasks.every((t) => t.status === 'recorded')) {
        const existing = readExplorationSummary(p.id);
        if (!existing) {
          await this.dispatchSynthesis(p.id);
          swept.push(p.id);
        }
      }
    }
    return swept;
  }

  private async dispatchSynthesis(projectId: string): Promise<void> {
    const request = await buildSynthesizeRequest(projectId, { db: this.db });
    if ('error' in request) return;

    try {
      const mma = await buildMmaClient({ db: this.db });
      await dispatchMma({
        db: this.db,
        mma,
        projectId,
        route: 'orchestrate',
        handler: 'explore-synthesize',
        cwd: resolveWorkspaceRoot(),
        body: {
          prompt: `${request.system}\n\n${request.user}`,
          reviewPolicy: 'none',
        },
        actorId: 'system',
      });
    } catch {
      // Synthesis dispatch failed — will retry on next bump or boot reconciliation
    }
  }

  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

let singleton: SynthesisScheduler | null = null;
export function getSynthesisScheduler(): SynthesisScheduler {
  if (!singleton) singleton = new SynthesisScheduler();
  return singleton;
}
