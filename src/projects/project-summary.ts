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
    const spanFromEvents = (
      kind: string,
      fallback: { startedAt?: string; completedAt?: string },
    ): { startedAt: string | null; completedAt: string | null } => {
      let start = Infinity, end = -Infinity;
      for (const e of events) {
        if (e.stage !== kind) continue;
        const t = new Date(e.createdAt).getTime();
        if (!Number.isFinite(t)) continue;
        start = Math.min(start, t);
        end = Math.max(end, t + (e.durationMs ?? 0));
      }
      if (start === Infinity) {
        return { startedAt: fallback.startedAt ?? null, completedAt: fallback.completedAt ?? null };
      }
      return { startedAt: new Date(start).toISOString(), completedAt: new Date(end).toISOString() };
    };
    stages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
      kind, status: d.stages[kind].status, ...spanFromEvents(kind, d.stages[kind]),
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
