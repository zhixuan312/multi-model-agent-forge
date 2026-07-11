import { asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { qaMessage } from '@/db/schema/spec';
import { auditPassHistory, type AuditPassView } from '@/spec/audit-loop';
import { readPlanFile } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';

/**
 * Plan-core — loads plan data for the plan stage RSC. Task content comes
 * from the physical `plan.md` file (source of truth). DB `plan_task` rows
 * provide metadata only (approval status, participants, execution state).
 */

export interface PlanTaskView {
  id: string;
  num: number;
  title: string;
  body: string;
  files: string[];
  dependsOn: string[];
  targetRepo: string;
  dbStatus?: string;
  phase?: string;
  approvedBy?: string[];
  participantIds?: string[];
}

export interface PlanPhaseView {
  id: string;
  title: string;
  tasks: PlanTaskView[];
}

export interface PlanView {
  phases: PlanPhaseView[];
  planMd: string | null;
  auditHistory: AuditPassView[];
  messages: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId: string | null }>>;
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

/** Extract task number from heading like "### Task 5: Title" → 5. */
function extractNum(heading: string): number {
  const m = heading.match(/Task\s+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** Group flat task list into phases by the `phase` field. */
export function groupTasksIntoPhases(tasks: PlanTaskView[]): PlanPhaseView[] {
  if (tasks.length === 0) return [];
  const hasPhases = tasks.some((t) => t.phase);
  if (!hasPhases) return [{ id: 'phase-1', title: 'Implementation', tasks }];
  const groups = new Map<string, PlanTaskView[]>();
  for (const t of tasks) {
    const key = t.phase || 'Other';
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([title, phaseTasks], i) => ({
    id: `phase-${i + 1}`,
    title,
    tasks: phaseTasks,
  }));
}

/** Load the full plan view for a project — tasks from plan.md, metadata from DB. */
export async function loadPlanView(db: Db, projectId: string): Promise<PlanView> {
  const dbi = db ?? getDb();

  const planFile = await readPlanFile(projectId);
  const planMd = planFile?.bodyMd ?? null;

  // If plan.md was deleted but DB still has tasks, reset — same pattern as spec loadOutline
  if (!planMd) {
    // Clear stale tasks from details
    const { updateDetails } = await import('@/details/write');
    try {
      await updateDetails(dbi, projectId, (d) => {
        d.stages.plan.phases.refine.tasks = [];
        d.stages.plan.phases.refine.file = undefined;
        return d;
      });
    } catch { /* no details yet — skip */ }
  }

  // Parse tasks from the physical plan.md file
  let tasks: PlanTaskView[] = [];
  if (planMd) {
    const sections = parsePlanSections(planMd);
    // Load DB metadata (approvals, status, participants) keyed by title
    // Read task metadata from details
    const { validateDetails } = await import('@/details/schema');
    const [proj] = await dbi.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
    const d = proj?.details ? validateDetails(proj.details) : null;
    const detailsTasks = d?.stages.plan.phases.refine.tasks ?? [];
    const detailsRepos = d?.repos ?? [];
    const firstRepoName = detailsRepos[0]?.name ?? '';

    const dbRows = detailsTasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, phase: null as string | null,
      targetRepoId: detailsRepos[0]?.id ?? null, dependsOn: null as string[] | null,
      repoName: firstRepoName,
    }));

    const approversByTask = new Map<string, string[]>();
    const reviewersByTask = new Map<string, string[]>();
    for (const t of detailsTasks) {
      if (t.approvals.length > 0) approversByTask.set(t.id, [...t.approvals]);
    }

    const metaByTitle = new Map(dbRows.map((r) => [r.title, r]));

    tasks = sections.map((s, i) => {
      const title = s.heading.replace(/^###\s*/, '').trim();
      const meta = metaByTitle.get(title);
      return {
        id: meta?.id ?? `file-task-${i}`,
        num: extractNum(s.heading) || (i + 1),
        title,
        body: s.body,
        files: extractFiles(s.body),
        dependsOn: [],
        targetRepo: meta?.repoName ?? '',
        dbStatus: meta?.status,
        phase: s.phase ?? meta?.phase ?? undefined,
        approvedBy: meta ? (approversByTask.get(meta.id) ?? []) : [],
        participantIds: meta ? (reviewersByTask.get(meta.id) ?? []) : [],
      };
    });
  }

  const phases = groupTasksIntoPhases(tasks);
  const planHistory = await auditPassHistory(dbi, projectId, 'plan');

  // Load discussion messages for all plan tasks (keyed by taskId)
  const taskIds = tasks.map((t) => t.id).filter((id) => !id.startsWith('file-task-'));
  const messages: PlanView['messages'] = {};
  if (taskIds.length > 0) {
    const { inArray } = await import('drizzle-orm');
    const rows = await dbi
      .select({ id: qaMessage.id, targetId: qaMessage.targetId, bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
      .from(qaMessage)
      .where(inArray(qaMessage.targetId, taskIds))
      .orderBy(asc(qaMessage.seq));
    const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
    for (const r of rows) {
      if (!r.targetId) continue;
      const list = messages[r.targetId] ?? [];
      const sender = r.authorId === FORGE_MEMBER_ID ? 'forge' : 'member';
      list.push({ id: r.id, sender: sender as 'forge' | 'member', bodyMd: r.bodyMd, authorId: r.authorId });
      messages[r.targetId] = list;
    }
  }

  return { phases, planMd, auditHistory: planHistory, messages };
}
