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
  archivedProjects,
  type ProjectListItem,
  type ProjectActor,
  type ProjectsDeps,
} from '@/projects/projects-core';
import { deriveNextAction, type NextAction } from '@/dashboard/next-action';
import { readExplorationFile, readSpecFile, readPlanFile } from '@/projects/project-files';
import { validateDetails } from '@/details/schema';

export interface DashboardCollaborator {
  id: string;
  displayName: string;
  avatarTint: string;
}

export interface DashboardProject extends ProjectListItem {
  /**
   * Spec components the human has not approved yet (`approvals` is empty).
   *
   * This said "the AI gate passed but the human gate hasn't". `componentSchema` carries
   * `approvals` and nothing else — there is no AI-gate flag in details to read — so that
   * was never what this counted, and a project showed "N sections need you" from the
   * moment its components existed.
   */
  awaitingHuman: number;
  /**
   * How many of the two audited stages (spec, plan) have a latest audit pass of
   * `revised` — so 0, 1 or 2. NOT a finding count: `auditPassSchema` stores `passNo`,
   * `status` and attempts, never the findings themselves.
   */
  auditsNeedingFix: number;
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

  // Audits needing a fix pass: per stage, whether its LATEST pass came back `revised`.
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

  // Latest artifact: furthest-along kind, with its REAL version. Each of these readers
  // returns `{ version, bodyMd }` and the version used to be discarded for a literal `1`,
  // so `ProjectCard` printed "Spec v1" for a spec on its fourteenth revision.
  const artByP = new Map<string, { kind: ArtifactKind; version: number }>();
  for (const pid of ids) {
    const plan = await readPlanFile(pid);
    if (plan) { artByP.set(pid, { kind: 'plan', version: plan.version }); continue; }
    const spec = await readSpecFile(pid);
    if (spec) { artByP.set(pid, { kind: 'spec', version: spec.version }); continue; }
    const exploration = await readExplorationFile(pid);
    if (exploration) artByP.set(pid, { kind: 'exploration', version: exploration.version });
  }

  // Collaborators: the members who ACTUALLY participated — details tracks participant
  // member-ids per stage. Union them across stages, drop the owner (shown separately),
  // resolve to names. NOT the whole roster: a project shows only who worked on it, so
  // a solo-driven project correctly shows just its owner.
  // Only spec / plan / journal carry a participants roster in details.
  const PARTICIPANT_STAGES = ['spec', 'plan', 'journal'] as const;

  // Collect the participant ids FIRST, then resolve exactly those. This used to read the
  // whole `member` table to build a lookup map and then use a handful of entries, so the
  // query grew with the organisation while the result never did.
  const idsByProject = new Map<string, Set<string>>();
  const needed = new Set<string>();
  for (const r of detailsRows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      const ids = new Set<string>();
      for (const k of PARTICIPANT_STAGES) for (const pid of d.stages[k].participants) ids.add(pid);
      ids.delete(r.ownerId);
      idsByProject.set(r.id, ids);
      for (const id of ids) needed.add(id);
    } catch { /* invalid details — skip */ }
  }

  const memberById = new Map(
    needed.size === 0
      ? []
      : (
          await db
            .select({ id: member.id, displayName: member.displayName, avatarTint: member.avatarTint })
            .from(member)
            .where(inArray(member.id, [...needed]))
        ).map((m) => [m.id, m] as const),
  );

  const collabByP = new Map<string, DashboardCollaborator[]>();
  for (const [projectId, ids] of idsByProject) {
    collabByP.set(
      projectId,
      [...ids].map((id) => memberById.get(id)).filter((m): m is DashboardCollaborator => !!m),
    );
  }

  const DESIGN_STAGES = new Set(['exploration', 'spec', 'plan']);

  return base.map((p) => {
    const inDesign = DESIGN_STAGES.has(p.currentStage ?? '');
    const awaitingHuman = inDesign ? (awaitingByP.get(p.id) ?? 0) : 0;
    const auditsNeedingFix = inDesign ? (auditByP.get(p.id) ?? 0) : 0;
    return {
      ...p,
      awaitingHuman,
      auditsNeedingFix,
      agentsRunning: agentsByP.get(p.id) ?? 0,
      latestArtifact: artByP.get(p.id) ?? null,
      collaborators: collabByP.get(p.id) ?? [],
      nextAction: deriveNextAction({
        phase: p.phase,
        currentStage: p.currentStage,
        awaitingHuman,
        auditsNeedingFix,
      }),
    };
  });
}

/**
 * Archived projects, shaped as `DashboardProject` for the shared card + filter
 * bar. Archive is a visibility overlay orthogonal to lifecycle, so the gate /
 * activity / audit signals are intentionally zeroed — an archived project isn't
 * a live control-tower row, it's a shelved one. `nextAction` still derives from
 * the frozen phase/stage so the card reads sensibly.
 */
export async function dashboardArchivedProjects(
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<DashboardProject[]> {
  const db: Db = deps.db ?? getDb();
  const rows = await archivedProjects(actor, { db });
  return rows.map((p) => ({
    ...p,
    awaitingHuman: 0,
    auditsNeedingFix: 0,
    agentsRunning: 0,
    latestArtifact: null,
    collaborators: [],
    nextAction: deriveNextAction({
      phase: p.phase,
      currentStage: p.currentStage,
      awaitingHuman: 0,
      auditsNeedingFix: 0,
    }),
  }));
}

/** The five flow-health metrics — reduced from the enriched list (no extra round-trips). */
export function dashboardMetrics(projects: DashboardProject[]): DashboardMetrics {
  return {
    // `!== 'learn'` alone counted COMPLETED projects as active — `details/write.ts` sets
    // `phase: 'completed'` at the end of the journal stage, and the store has such rows.
    active: projects.filter((p) => p.phase !== 'learn' && p.phase !== 'completed').length,
    awaitingHuman: projects.filter((p) => p.awaitingHuman > 0).length,
    agentsRunning: projects.filter((p) => p.agentsRunning > 0).length,
    inBuild: projects.filter((p) => p.phase === 'build').length,
    auditIssues: projects.filter((p) => p.auditsNeedingFix > 0).length,
  };
}
