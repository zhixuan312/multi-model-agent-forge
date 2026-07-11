import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { readSpecFile, readPlanFile } from '@/projects/project-files';
import { validateDetails, type ProjectEvent } from '@/details/schema';

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
  events: ProjectEvent[];
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
  let events: ProjectEvent[] = [];

  if (proj?.details) {
    const d = validateDetails(proj.details);
    events = d.events;
    stages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
      kind, status: d.stages[kind].status,
      startedAt: d.stages[kind].startedAt ?? null,
      completedAt: d.stages[kind].completedAt ?? null,
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
