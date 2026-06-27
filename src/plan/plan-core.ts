import { asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { auditPassHistory, type AuditPassView } from '@/spec/audit-loop';
import { readPlanFileAsync } from '@/projects/project-files';

/**
 * Plan-core — loads plan data for the plan stage RSC. Tasks from DB,
 * plan markdown from the physical `plan.md` file. Mirrors spec-core's role.
 */

/** Client-safe plan task view (matches PlanTaskSeed shape for PlanStageClient compat). */
export interface PlanTaskView {
  id: string;
  num: number;
  title: string;
  body: string;
  files: string[];
  dependsOn: string[];
  targetRepo: string;
  dbStatus?: string;
}

/** Client-safe plan phase (group of tasks). */
export interface PlanPhaseView {
  id: string;
  title: string;
  tasks: PlanTaskView[];
}

/** Full plan view for the RSC. */
export interface PlanView {
  phases: PlanPhaseView[];
  planMd: string | null;
  auditHistory: AuditPassView[];
}

/** Extract file paths from the task detail's `**Files:**` preamble. */
function extractFiles(detail: string): string[] {
  const files: string[] = [];
  const fileSection = detail.match(/\*\*Files:\*\*\n((?:- .+\n?)+)/);
  if (!fileSection) return files;
  const lines = fileSection[1].split('\n').filter((l) => l.startsWith('- '));
  for (const line of lines) {
    const match = line.match(/`([^`]+)`/);
    if (match) files.push(match[1]);
  }
  return files;
}

/** Extract task number from title like "Task 5: Implement handler" → 5. */
function extractNum(title: string): number {
  const m = title.match(/Task\s+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** Map a DB plan_task row to a client-safe view. */
export function planTaskToView(
  row: {
    id: string;
    title: string;
    detail: string | null;
    targetRepoId: string;
    dependsOn: string[] | null;
    orderIndex: number;
    reviewPolicy: string;
    status: string;
  },
  repoName: string,
  titleById?: Map<string, string>,
): PlanTaskView {
  const body = row.detail ?? '';
  return {
    id: row.id,
    num: extractNum(row.title) || (row.orderIndex + 1),
    title: row.title,
    body,
    files: extractFiles(body),
    dependsOn: (row.dependsOn ?? []).map((id) => titleById?.get(id) ?? id),
    targetRepo: repoName,
    dbStatus: row.status,
  };
}

/** Group flat task list into phases. For now: single "Implementation" phase. */
export function groupTasksIntoPhases(tasks: PlanTaskView[]): PlanPhaseView[] {
  if (tasks.length === 0) return [];
  return [{ id: 'phase-1', title: 'Implementation', tasks }];
}

/** Load the full plan view for a project. */
export async function loadPlanView(db: Db, projectId: string): Promise<PlanView> {
  const dbi = db ?? getDb();

  // Load plan tasks + repo names
  const rows = await dbi
    .select({
      id: planTask.id,
      title: planTask.title,
      detail: planTask.detail,
      targetRepoId: planTask.targetRepoId,
      dependsOn: planTask.dependsOn,
      orderIndex: planTask.orderIndex,
      reviewPolicy: planTask.reviewPolicy,
      status: planTask.status,
      repoName: repo.name,
    })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, projectId))
    .orderBy(asc(planTask.orderIndex));

  // Build title lookup for dependsOn resolution
  const titleById = new Map(rows.map((r) => [r.id, r.title]));
  const tasks = rows.map((r) => planTaskToView(r, r.repoName ?? '', titleById));
  const phases = groupTasksIntoPhases(tasks);

  // Load plan from physical file
  const planFile = await readPlanFileAsync(projectId);

  const planHistory = await auditPassHistory(dbi, projectId, 'plan');

  return {
    phases,
    planMd: planFile?.bodyMd ?? null,
    auditHistory: planHistory,
  };
}
