/**
 * Dashboard core (Projects control tower) — enriches the visible-project list
 * with the gate / activity / artifact signals the control tower needs, then
 * derives each project's next action and the five flow-health metrics.
 *
 * Every signal is a real, queryable column — no fabricated data. Same bounded
 * two-pass shape as `visibleProjects` (one query per signal over the scoped id
 * set), so it stays O(round-trips), never N+1.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { member } from '@/db/schema/identity';
import type { ArtifactKind } from '@/db/enums';
import {
  visibleProjects,
  type ProjectListItem,
  type ProjectActor,
  type ProjectsDeps,
} from '@/projects/projects-core';
import { deriveNextAction, type NextAction } from '@/dashboard/next-action';
import { readExplorationSummary, readSpecFile, readPlanFile } from '@/projects/project-files';
import { validateDetails } from '@/details/schema';

export interface DashboardCollaborator {
  id: string;
  displayName: string;
  avatarTint: string;
}

export interface DashboardProject extends ProjectListItem {
  /** Spec sections where the AI gate passed but the human gate hasn't (the keystone signal). */
  awaitingHuman: number;
  /** Open findings on the latest audit pass per scope. */
  openAuditIssues: number;
  /** Live agent work — running mma batches + running exploration tasks. */
  agentsRunning: number;
  /** The furthest-along artifact, for the status chip. */
  latestArtifact: { kind: ArtifactKind; version: number } | null;
  /** Project members other than the owner. */
  collaborators: DashboardCollaborator[];
  nextAction: NextAction;
}

export interface DashboardMetrics {
  active: number;
  awaitingHuman: number;
  agentsRunning: number;
  inBuild: number;
  auditIssues: number;
}

export async function dashboardProjects(
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<DashboardProject[]> {
  const db: Db = deps.db ?? getDb();
  const base = await visibleProjects(actor, { db });
  if (base.length === 0) return [];
  const ids = base.map((p) => p.id);

  // Load details for all projects in one pass
  const detailsRows = await db
    .select({ id: project.id, details: project.details, ownerId: project.ownerId })
    .from(project)
    .where(inArray(project.id, ids));

  // Awaiting-human: components with approvals from details
  const awaitingByP = new Map<string, number>();
  for (const r of detailsRows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      const comps = d.stages.spec.phases.craft.components;
      const templates = comps.filter((c) => c.approvals.length === 0);
      awaitingByP.set(r.id, templates.length);
    } catch { /* skip invalid */ }
  }

  // Open audit issues: from details audit passes
  const auditByP = new Map<string, number>();
  for (const r of detailsRows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      let issues = 0;
      for (const passes of [d.stages.spec.phases.finalize.auditPasses, d.stages.plan.phases.validate.auditPasses]) {
        if (passes.length > 0) {
          const latest = passes[passes.length - 1];
          if (latest.status === 'revised') issues++;
        }
      }
      if (issues > 0) auditByP.set(r.id, issues);
    } catch { /* skip */ }
  }

  // Agents running: running mma batches + running exploration tasks from details
  const agentsByP = new Map<string, number>();
  const mmaRun = await db
    .select({ projectId: mmaBatch.projectId, n: sql<number>`count(*)::int` })
    .from(mmaBatch)
    .where(and(inArray(mmaBatch.projectId, ids), eq(mmaBatch.status, 'running')))
    .groupBy(mmaBatch.projectId);
  for (const r of mmaRun) if (r.projectId) agentsByP.set(r.projectId, Number(r.n));
  for (const r of detailsRows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      const running = d.stages.exploration.phases.discover.tasks.filter((t) => t.status === 'running').length;
      if (running > 0) agentsByP.set(r.id, (agentsByP.get(r.id) ?? 0) + running);
    } catch { /* skip */ }
  }

  // Latest artifact: furthest-along kind — all checked via file existence.
  const artByP = new Map<string, { kind: ArtifactKind; version: number }>();
  for (const pid of ids) {
    if (await readPlanFile(pid)) {
      artByP.set(pid, { kind: 'plan', version: 1 });
    } else if (await readSpecFile(pid)) {
      artByP.set(pid, { kind: 'spec', version: 1 });
    } else if (await readExplorationSummary(pid)) {
      artByP.set(pid, { kind: 'exploration', version: 1 });
    }
  }

  // Collaborators: the members who ACTUALLY participated — details tracks participant
  // member-ids per stage. Union them across stages, drop the owner (shown separately),
  // resolve to names. NOT the whole roster: a project shows only who worked on it, so
  // a solo-driven project correctly shows just its owner.
  const memberById = new Map(
    (await db.select({ id: member.id, displayName: member.displayName, avatarTint: member.avatarTint }).from(member))
      .map((m) => [m.id, m]),
  );
  // Only spec / plan / journal carry a participants roster in details.
  const PARTICIPANT_STAGES = ['spec', 'plan', 'journal'] as const;
  const collabByP = new Map<string, DashboardCollaborator[]>();
  for (const r of detailsRows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      const ids = new Set<string>();
      for (const k of PARTICIPANT_STAGES) for (const pid of d.stages[k].participants) ids.add(pid);
      ids.delete(r.ownerId);
      collabByP.set(
        r.id,
        [...ids].map((id) => memberById.get(id)).filter((m): m is DashboardCollaborator => !!m),
      );
    } catch { /* invalid details — skip */ }
  }

  const DESIGN_STAGES = new Set(['exploration', 'spec', 'plan']);

  return base.map((p) => {
    const inDesign = DESIGN_STAGES.has(p.currentStage ?? '');
    const awaitingHuman = inDesign ? (awaitingByP.get(p.id) ?? 0) : 0;
    const openAuditIssues = inDesign ? (auditByP.get(p.id) ?? 0) : 0;
    return {
      ...p,
      awaitingHuman,
      openAuditIssues,
      agentsRunning: agentsByP.get(p.id) ?? 0,
      latestArtifact: artByP.get(p.id) ?? null,
      collaborators: collabByP.get(p.id) ?? [],
      nextAction: deriveNextAction({
        phase: p.phase,
        currentStage: p.currentStage,
        awaitingHuman,
        openAuditIssues,
      }),
    };
  });
}

/** The five flow-health metrics — reduced from the enriched list (no extra round-trips). */
export function dashboardMetrics(projects: DashboardProject[]): DashboardMetrics {
  return {
    active: projects.filter((p) => p.phase !== 'learn').length,
    awaitingHuman: projects.filter((p) => p.awaitingHuman > 0).length,
    agentsRunning: projects.filter((p) => p.agentsRunning > 0).length,
    inBuild: projects.filter((p) => p.phase === 'build').length,
    auditIssues: projects.filter((p) => p.openAuditIssues > 0).length,
  };
}
