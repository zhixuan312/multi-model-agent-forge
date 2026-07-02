import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { auditPass } from '@/db/schema/artifacts';
import { planTask } from '@/db/schema/build';
import { learningCandidate } from '@/db/schema/learning';
import { readSpecFileAsync, readPlanFileAsync } from '@/projects/project-files';

export interface StageTiming {
  kind: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ProjectSummary {
  projectName: string;
  createdAt: Date;
  completedAt: Date | null;

  timeline: {
    stages: StageTiming[];
  };

  cost: {
    totalUsd: number;
    savedUsd: number;
  };

  effort: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
  };

  quality: {
    auditPasses: Array<{ scope: string; passNo: number; findingsCount: number; verdict: string }>;
    specVersion: number;
    planVersion: number;
  };

  delivery: {
    totalTasks: number;
    committed: number;
    failed: number;
    skipped: number;
  };

  knowledge: {
    recorded: number;
    byCategory: Record<string, number>;
    byOrigin: Record<string, number>;
  };
}

export async function loadProjectSummary(db: Db, projectId: string): Promise<ProjectSummary> {
  const dbi = db ?? getDb();

  const [proj] = await dbi
    .select({ name: project.name, createdAt: project.createdAt, completedAt: project.completedAt })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  const stages = await dbi
    .select({ kind: stage.kind, status: stage.status, startedAt: stage.startedAt, completedAt: stage.completedAt })
    .from(stage)
    .where(eq(stage.projectId, projectId));

  const batches = await dbi
    .select({
      route: mmaBatch.route,
      status: mmaBatch.status,
      costUsd: mmaBatch.costUsd,
      savedVsMainUsd: mmaBatch.savedVsMainUsd,
      inputTokens: mmaBatch.inputTokens,
      outputTokens: mmaBatch.outputTokens,
      durationMs: mmaBatch.durationMs,
    })
    .from(mmaBatch)
    .where(eq(mmaBatch.projectId, projectId));

  const audits = await dbi
    .select({ scope: auditPass.scope, passNo: auditPass.passNo, findingsCount: auditPass.findingsCount, verdict: auditPass.verdict })
    .from(auditPass)
    .where(eq(auditPass.projectId, projectId));

  const tasks = await dbi
    .select({ status: planTask.status, commitSha: planTask.commitSha })
    .from(planTask)
    .where(eq(planTask.projectId, projectId));

  const learnings = await dbi
    .select({ status: learningCandidate.status, type: learningCandidate.type, origin: learningCandidate.origin })
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, projectId));

  const specFile = await readSpecFileAsync(projectId);
  const planFile = await readPlanFileAsync(projectId);

  const doneBatches = batches.filter((b) => b.status === 'done');
  const totalUsd = doneBatches.reduce((sum, b) => sum + Number(b.costUsd ?? 0), 0);
  const savedUsd = doneBatches.reduce((sum, b) => sum + Number(b.savedVsMainUsd ?? 0), 0);

  const recorded = learnings.filter((l) => l.status === 'recorded');
  const byCategory: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  for (const l of recorded) {
    byCategory[l.type] = (byCategory[l.type] ?? 0) + 1;
    byOrigin[l.origin] = (byOrigin[l.origin] ?? 0) + 1;
  }

  return {
    projectName: proj?.name ?? '',
    createdAt: proj?.createdAt ?? new Date(),
    completedAt: proj?.completedAt ?? null,

    timeline: {
      stages: stages.map((s) => ({
        kind: s.kind,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    },

    cost: { totalUsd, savedUsd },

    effort: {
      totalCalls: doneBatches.length,
      totalInputTokens: doneBatches.reduce((sum, b) => sum + (b.inputTokens ?? 0), 0),
      totalOutputTokens: doneBatches.reduce((sum, b) => sum + (b.outputTokens ?? 0), 0),
      totalDurationMs: doneBatches.reduce((sum, b) => sum + (b.durationMs ?? 0), 0),
    },

    quality: {
      auditPasses: audits.map((a) => ({ scope: a.scope, passNo: a.passNo, findingsCount: a.findingsCount, verdict: a.verdict })),
      specVersion: specFile?.version ?? 0,
      planVersion: planFile?.version ?? 0,
    },

    delivery: {
      totalTasks: tasks.length,
      committed: tasks.filter((t) => t.status === 'committed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      skipped: tasks.filter((t) => t.status === 'skipped').length,
    },

    knowledge: {
      recorded: recorded.length,
      byCategory,
      byOrigin,
    },
  };
}
