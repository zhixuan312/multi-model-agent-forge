import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { ProjectEventBus, projectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { synthesize, type SynthesizeDeps } from '@/exploration/synthesize';
import { readExplorationSummary } from '@/projects/project-files';

/**
 * `SynthesisScheduler` — watches terminal task events and debounces
 * re-synthesis. After a 5s quiet window with no new terminal record,
 * invokes synthesis. Boot reconciliation catches projects that crashed
 * mid-synthesis.
 */

export const SYNTHESIS_DEBOUNCE_MS = 5_000;

export interface SchedulerDeps extends SynthesizeDeps {
  bus?: ProjectEventBus;
  debounceMs?: number;
}

export class SynthesisScheduler {
  private readonly db: Db;
  private readonly bus: ProjectEventBus;
  private readonly debounceMs: number;
  private readonly synthDeps: SynthesizeDeps;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsub: (() => void) | null = null;
  private readonly subscribed = new Set<string>();

  constructor(deps: SchedulerDeps = {}) {
    this.db = deps.db ?? getDb();
    this.bus = deps.bus ?? projectEventBus;
    this.debounceMs = deps.debounceMs ?? SYNTHESIS_DEBOUNCE_MS;
    this.synthDeps = { db: this.db, anthropic: deps.anthropic, bus: this.bus };
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
      void synthesize(projectId, null, this.synthDeps);
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
    await synthesize(projectId, null, this.synthDeps);
  }

  /**
   * Boot reconciliation: for projects with all tasks terminal but no
   * exploration.md file on disk, run one synthesis pass.
   */
  async reconcileOnBoot(): Promise<string[]> {
    const taskAgg = await this.db
      .select({
        projectId: explorationTask.projectId,
        total: sql<number>`count(*)::int`,
        recorded: sql<number>`sum(case when ${explorationTask.status} = 'recorded' then 1 else 0 end)::int`,
      })
      .from(explorationTask)
      .leftJoin(mmaBatch, eq(explorationTask.mmaBatchId, mmaBatch.id))
      .groupBy(explorationTask.projectId);

    const candidates = taskAgg.filter((p) => p.total > 0 && p.recorded === p.total);
    if (candidates.length === 0) return [];

    const swept: string[] = [];
    for (const c of candidates) {
      const existing = readExplorationSummary(c.projectId);
      if (!existing) {
        await synthesize(c.projectId, null, this.synthDeps);
        swept.push(c.projectId);
      }
    }
    return swept;
  }

  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.unsub) this.unsub();
  }
}

let singleton: SynthesisScheduler | null = null;
export function getSynthesisScheduler(): SynthesisScheduler {
  if (!singleton) singleton = new SynthesisScheduler();
  return singleton;
}
