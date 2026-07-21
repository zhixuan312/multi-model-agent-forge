import { eq, asc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { projectActivity } from '@/db/schema/activity';
import { readSpecFile, readPlanFile } from '@/projects/project-files';
import { validateDetails } from '@/details/schema';
import { mapActivityRowToEvent, type ProjectActivityEvent } from '@/activity/project-activity';

export interface StageTiming {
  kind: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Active work time — the stage's event span minus long idle pauses (a project left
   *  overnight or for days). This is "how long the stage took" of actual work, so a
   *  3-day pause inside a stage doesn't render as a 79-hour stage. */
  activeMs: number;
}

export interface ProjectSummary {
  projectName: string;
  createdAt: Date;
  completedAt: Date | null;
  timeline: { stages: StageTiming[] };
  cost: { totalUsd: number; savedUsd: number };
  effort: { totalCalls: number; totalInputTokens: number; totalOutputTokens: number; totalDurationMs: number };
  quality: { auditPasses: Array<{ scope: string; passNo: number; status: string }>; specVersion: number; planVersion: number };
  delivery: { totalTasks: number; approved: number };
  knowledge: { recorded: number; byType: Record<string, number> };
  /** The full project activity timeline (explore→journal) for the Summary rail. */
  events: ProjectActivityEvent[];
}

export async function loadProjectSummary(db: Db, projectId: string): Promise<ProjectSummary> {
  const dbi = db ?? getDb();

  const [proj] = await dbi
    .select({ name: project.name, createdAt: project.createdAt, completedAt: project.completedAt, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  const batches = await dbi
    .select({
      status: mmaBatch.status, costUsd: mmaBatch.costUsd, savedVsMainUsd: mmaBatch.savedVsMainUsd,
      inputTokens: mmaBatch.inputTokens, outputTokens: mmaBatch.outputTokens, durationMs: mmaBatch.durationMs,
    })
    .from(mmaBatch)
    .where(eq(mmaBatch.projectId, projectId));

  const specFile = await readSpecFile(projectId);
  const planFile = await readPlanFile(projectId);

  const doneBatches = batches.filter((b) => b.status === 'done');
  const totalUsd = doneBatches.reduce((sum, b) => sum + Number(b.costUsd ?? 0), 0);
  const savedUsd = doneBatches.reduce((sum, b) => sum + Number(b.savedVsMainUsd ?? 0), 0);

  let stages: StageTiming[] = [];
  const auditPasses: Array<{ scope: string; passNo: number; status: string }> = [];
  let tasks: Array<{ status: string }> = [];
  let learnings: Array<{ type: string; status: string }> = [];
  let events: ProjectActivityEvent[] = [];

  const activityRows = await dbi
    .select()
    .from(projectActivity)
    .where(eq(projectActivity.projectId, projectId))
    .orderBy(asc(projectActivity.seq));
  events = activityRows.map(mapActivityRowToEvent);

  if (proj?.details) {
    const d = validateDetails(proj.details);
    // Stage timing is derived from the activity events, NOT `details.startedAt/completedAt`.
    // Those details timestamps collapse to a single value when a project is force-completed
    // (mark_complete / bulk advance backfill every unstamped stage with one `now`), which
    // renders a garbage timeline (every stage ending at the same instant). Each activity
    // event instead carries its own real `createdAt` and `durationMs`, so an event occupies
    // [createdAt, createdAt + durationMs] and a stage spans the union of its events. Only
    // when a stage produced no events at all do we fall back to the details timestamps.
    // A gap longer than this between one event ending and the next starting is an idle
    // pause (a project left overnight or for days), not work — excluded from `activeMs`.
    // Continuous work with no intermediate events (a long investigate batch) leaves gaps
    // well under this, so it still counts.
    const IDLE_GAP_MS = 6 * 60 * 60 * 1000;
    const timingFromEvents = (
      kind: string,
      fallback: { startedAt?: string; completedAt?: string },
    ): { startedAt: string | null; completedAt: string | null; activeMs: number } => {
      const intervals = events
        .filter((e) => e.stage === kind)
        .map((e) => {
          const t = new Date(e.createdAt).getTime();
          return Number.isFinite(t) ? { start: t, end: t + (e.durationMs ?? 0) } : null;
        })
        .filter((x): x is { start: number; end: number } => x !== null)
        .sort((a, b) => a.start - b.start);

      if (intervals.length === 0) {
        const s = fallback.startedAt ? new Date(fallback.startedAt).getTime() : null;
        const e = fallback.completedAt ? new Date(fallback.completedAt).getTime() : null;
        // A collapsed/absurd fallback span (see the note above) still shouldn't render as
        // days; cap the fallback active time at the idle threshold.
        const active = s !== null && e !== null ? Math.min(Math.max(0, e - s), IDLE_GAP_MS) : 0;
        return { startedAt: fallback.startedAt ?? null, completedAt: fallback.completedAt ?? null, activeMs: active };
      }

      let active = 0;
      let curStart = intervals[0].start, curEnd = intervals[0].end;
      for (let i = 1; i < intervals.length; i++) {
        const iv = intervals[i];
        if (iv.start - curEnd > IDLE_GAP_MS) {
          active += curEnd - curStart; // close the current active cluster; the gap is idle
          curStart = iv.start;
        }
        curEnd = Math.max(curEnd, iv.end);
      }
      active += curEnd - curStart;
      return {
        startedAt: new Date(intervals[0].start).toISOString(),
        completedAt: new Date(curEnd).toISOString(),
        activeMs: active,
      };
    };
    stages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
      kind, status: d.stages[kind].status, ...timingFromEvents(kind, d.stages[kind]),
    }));
    for (const p of d.stages.spec.phases.finalize.auditPasses) {
      auditPasses.push({ scope: 'spec', passNo: p.passNo, status: p.status });
    }
    for (const p of d.stages.plan.phases.validate.auditPasses) {
      auditPasses.push({ scope: 'plan', passNo: p.passNo, status: p.status });
    }
    tasks = d.stages.plan.phases.refine.tasks.map((t) => ({ status: t.status }));
    learnings = d.stages.journal.phases.journal.learnings;
  }

  const recorded = learnings.filter((l) => l.status === 'recorded');
  const byType: Record<string, number> = {};
  for (const l of recorded) byType[l.type] = (byType[l.type] ?? 0) + 1;

  return {
    projectName: proj?.name ?? '',
    createdAt: proj?.createdAt ?? new Date(),
    completedAt: proj?.completedAt ?? null,
    timeline: { stages },
    cost: { totalUsd, savedUsd },
    effort: {
      totalCalls: doneBatches.length,
      totalInputTokens: doneBatches.reduce((sum, b) => sum + (b.inputTokens ?? 0), 0),
      totalOutputTokens: doneBatches.reduce((sum, b) => sum + (b.outputTokens ?? 0), 0),
      totalDurationMs: doneBatches.reduce((sum, b) => sum + (b.durationMs ?? 0), 0),
    },
    quality: { auditPasses, specVersion: specFile?.version ?? 0, planVersion: planFile?.version ?? 0 },
    delivery: { totalTasks: tasks.length, approved: tasks.filter((t) => t.status === 'approved').length },
    knowledge: { recorded: recorded.length, byType },
    events,
  };
}
