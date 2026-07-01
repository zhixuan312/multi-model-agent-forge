import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { participant } from '@/db/schema/participants';
import { qaMessage } from '@/db/schema/spec';
import { repo } from '@/db/schema/workspace';
import { auditPassHistory, type AuditPassView } from '@/spec/audit-loop';
import { readPlanFileAsync } from '@/projects/project-files';
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

  const planFile = await readPlanFileAsync(projectId);
  const planMd = planFile?.bodyMd ?? null;

  // If plan.md was deleted but DB still has tasks, reset — same pattern as spec loadOutline
  if (!planMd) {
    const staleTaskIds = (await dbi
      .select({ id: planTask.id })
      .from(planTask)
      .where(eq(planTask.projectId, projectId)))
      .map((r) => r.id);
    if (staleTaskIds.length > 0) {
      await dbi.delete(qaMessage).where(inArray(qaMessage.componentId, staleTaskIds));
      await dbi.delete(participant).where(and(eq(participant.scope, 'task'), inArray(participant.scopeId, staleTaskIds)));
      await dbi.delete(planTask).where(eq(planTask.projectId, projectId));
    }
  }

  // Parse tasks from the physical plan.md file
  let tasks: PlanTaskView[] = [];
  if (planMd) {
    const sections = parsePlanSections(planMd);
    // Load DB metadata (approvals, status, participants) keyed by title
    const dbRows = await dbi
      .select({
        id: planTask.id,
        title: planTask.title,
        status: planTask.status,
        phase: planTask.phase,
        targetRepoId: planTask.targetRepoId,
        dependsOn: planTask.dependsOn,
        repoName: repo.name,
      })
      .from(planTask)
      .leftJoin(repo, eq(planTask.targetRepoId, repo.id))
      .where(eq(planTask.projectId, projectId))
      .orderBy(asc(planTask.orderIndex));

    const taskIds = dbRows.map((r) => r.id);
    const taskParticipants = taskIds.length > 0
      ? await dbi
          .select({ scopeId: participant.scopeId, memberId: participant.memberId, role: participant.role })
          .from(participant)
          .where(and(eq(participant.scope, 'task'), inArray(participant.scopeId, taskIds)))
      : [];
    const approversByTask = new Map<string, string[]>();
    const reviewersByTask = new Map<string, string[]>();
    for (const p of taskParticipants) {
      if (!p.scopeId) continue;
      const map = p.role === 'approver' ? approversByTask : reviewersByTask;
      const list = map.get(p.scopeId) ?? [];
      list.push(p.memberId);
      map.set(p.scopeId, list);
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
      .select({ id: qaMessage.id, componentId: qaMessage.componentId, sender: qaMessage.sender, bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
      .from(qaMessage)
      .where(inArray(qaMessage.componentId, taskIds))
      .orderBy(asc(qaMessage.seq));
    for (const r of rows) {
      if (!r.componentId) continue;
      const list = messages[r.componentId] ?? [];
      list.push({ id: r.id, sender: r.sender as 'forge' | 'member', bodyMd: r.bodyMd, authorId: r.authorId });
      messages[r.componentId] = list;
    }
  }

  return { phases, planMd, auditHistory: planHistory, messages };
}
