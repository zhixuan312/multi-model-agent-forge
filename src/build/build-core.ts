import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { getLatestPlanArtifact, loadPlanTasks } from '@/build/plan-author';
import { planAuditHistory } from '@/build/audit-plan-loop';

/**
 * Build-monitor read DTOs. The RSC first-paint loads the plan from file +
 * plan_task rows + plan audit-pass ledger; the client island subscribes to
 * SSE and patches the cache thereafter.
 */

export interface PlanTaskView {
  id: string;
  title: string;
  detail: string | null;
  repoName: string;
  status: string;
  reviewPolicy: string;
  branch: string | null;
  commitSha: string | null;
  fixNote: string | null;
  dependsOn: string[];
  buildCmd: string | null;
  testCmd: string | null;
}

export interface AuditPassView {
  passNo: number;
  findingsCount: number;
  verdict: string;
}

export interface BuildView {
  planMd: string | null;
  planVersion: number | null;
  tasks: PlanTaskView[];
  writeTargets: string[];
  readOnly: string[];
  auditPasses: AuditPassView[];
}

/** Load the full build view for a project (RSC first paint). */
export async function loadBuildView(db: Db, projectId: string): Promise<BuildView> {
  const dbi = db ?? getDb();
  const planArtifact = await getLatestPlanArtifact(dbi, projectId);
  const rawTasks = await loadPlanTasks(dbi, projectId);
  const passes = await planAuditHistory(dbi, projectId);

  const tasks: PlanTaskView[] = rawTasks.map((t) => {
    const meta = (t.meta ?? {}) as { buildCmd?: string | null; testCmd?: string | null };
    return {
      id: t.id,
      title: t.title,
      detail: t.detail,
      repoName: t.repoName,
      status: t.status,
      reviewPolicy: t.reviewPolicy,
      branch: t.branch,
      commitSha: t.commitSha,
      fixNote: t.fixNote,
      dependsOn: t.dependsOn ?? [],
      buildCmd: meta.buildCmd ?? null,
      testCmd: meta.testCmd ?? null,
    };
  });

  const writeTargets = [...new Set(tasks.map((t) => t.repoName))];

  return {
    planMd: planArtifact?.bodyMd ?? null,
    planVersion: planArtifact?.version ?? null,
    tasks,
    writeTargets,
    readOnly: await readOnlyRepos(dbi, projectId, new Set(writeTargets)),
    auditPasses: passes.map((p) => ({ passNo: p.passNo, findingsCount: p.findingsCount, verdict: p.verdict })),
  };
}

/** The project's repos that are NOT a write target (read-only context). */
async function readOnlyRepos(db: Db, projectId: string, writeTargets: Set<string>): Promise<string[]> {
  const { projectRepo } = await import('@/db/schema/projects');
  const { repo } = await import('@/db/schema/workspace');
  const rows = await db
    .select({ name: repo.name })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, projectId));
  return rows.map((r) => r.name).filter((n) => !writeTargets.has(n));
}
