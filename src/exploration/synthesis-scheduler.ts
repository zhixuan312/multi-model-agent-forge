import { and, eq, max, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { ProjectEventBus, projectEventBus, type ProjectEvent } from '@/sse/event-bus';
import { synthesize, type SynthesizeDeps } from '@/exploration/synthesize';

/**
 * `SynthesisScheduler` (Spec 5 flow E) — the SINGLE named owner of the
 * re-synthesis decision. Subscribes to the per-project bus, watches
 * `task.done`/`task.failed`, and debounces: it (re-)invokes synthesis after a 5s
 * quiet window with no new terminal record, plus one final pass when the
 * in-flight set empties. The poll loop and SSE route NEVER invoke synthesis
 * directly.
 *
 * Boot reconciliation sweep: for each project whose tasks are all terminal
 * (`recorded`) but which has no `artifact(kind='exploration')` at/after the
 * latest task `terminal_at`, trigger one final synthesis pass (restart-durable).
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
  /** Projects this scheduler subscribes to (per-project subscription on demand). */
  private readonly subscribed = new Set<string>();

  constructor(deps: SchedulerDeps = {}) {
    this.db = deps.db ?? getDb();
    this.bus = deps.bus ?? projectEventBus;
    this.debounceMs = deps.debounceMs ?? SYNTHESIS_DEBOUNCE_MS;
    this.synthDeps = { db: this.db, anthropic: deps.anthropic, bus: this.bus };
  }

  /** Subscribe to a project's bus channel and (re)synthesize on terminal records. */
  watch(projectId: string): void {
    if (this.subscribed.has(projectId)) return;
    this.subscribed.add(projectId);
    this.bus.subscribe(projectId, (e: ProjectEvent) => {
      if (e.type === 'task.done' || e.type === 'task.failed') {
        this.bump(projectId);
      }
    });
  }

  /** (Re)start the per-project debounce timer; fires synthesis after the window. */
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

  /** Whether a debounce timer is currently armed for a project (test surface). */
  isArmed(projectId: string): boolean {
    return this.timers.has(projectId);
  }

  /** Force-flush a project's pending synthesis now (test surface / final pass). */
  async flush(projectId: string): Promise<void> {
    const existing = this.timers.get(projectId);
    if (existing) clearTimeout(existing);
    this.timers.delete(projectId);
    await synthesize(projectId, null, this.synthDeps);
  }

  /**
   * Boot reconciliation sweep (F24). For each project whose tasks are ALL
   * terminal but has no exploration artifact at/after the latest `terminal_at`,
   * run one final synthesis pass. A project whose latest artifact already
   * post-dates its tasks is left untouched.
   */
  async reconcileOnBoot(): Promise<string[]> {
    // Projects with at least one recorded task, plus their latest terminal_at.
    const taskAgg = await this.db
      .select({
        projectId: explorationTask.projectId,
        latestTerminal: sql<Date | null>`max(${mmaBatch.terminalAt})`,
        total: sql<number>`count(*)::int`,
        recorded: sql<number>`sum(case when ${explorationTask.status} = 'recorded' then 1 else 0 end)::int`,
      })
      .from(explorationTask)
      .leftJoin(mmaBatch, eq(explorationTask.mmaBatchId, mmaBatch.id))
      .groupBy(explorationTask.projectId);

    const candidates = taskAgg.filter((p) => p.total > 0 && p.recorded === p.total && p.latestTerminal);
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => c.projectId);
    const artRows = await this.db
      .select({
        projectId: artifact.projectId,
        latest: sql<Date | null>`max(${artifact.createdAt})`,
      })
      .from(artifact)
      .where(and(inArray(artifact.projectId, ids), eq(artifact.kind, 'exploration')))
      .groupBy(artifact.projectId);
    const latestArtByProject = new Map(artRows.map((a) => [a.projectId, a.latest]));

    const swept: string[] = [];
    for (const c of candidates) {
      const latestArt = toMs(latestArtByProject.get(c.projectId));
      const latestTerminal = toMs(c.latestTerminal);
      const owed = latestArt === null || (latestTerminal !== null && latestArt < latestTerminal);
      if (owed) {
        await synthesize(c.projectId, null, this.synthDeps);
        swept.push(c.projectId);
      }
    }
    return swept;
  }

  /** Clear all timers (test teardown). */
  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.unsub) this.unsub();
  }
}

/** Coerce a DB timestamp (Date or ISO string) to epoch ms, or null. */
function toMs(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Helper used by reconcile to find max version (kept for callers). */
export async function latestExplorationVersion(projectId: string, db: Db = getDb()): Promise<number> {
  const [{ v } = { v: null }] = await db
    .select({ v: max(artifact.version) })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
  return v ?? 0;
}

let singleton: SynthesisScheduler | null = null;
export function getSynthesisScheduler(): SynthesisScheduler {
  if (!singleton) singleton = new SynthesisScheduler();
  return singleton;
}
