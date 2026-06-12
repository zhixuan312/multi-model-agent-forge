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
import { projectMember, stage } from '@/db/schema/projects';
import { component, componentSection } from '@/db/schema/spec';
import { mmaBatch } from '@/db/schema/mma';
import { explorationTask } from '@/db/schema/exploration';
import { auditPass, artifact } from '@/db/schema/artifacts';
import { member } from '@/db/schema/identity';
import type { ArtifactKind } from '@/db/enums';
import {
  visibleProjects,
  type ProjectListItem,
  type ProjectActor,
  type ProjectsDeps,
} from '@/projects/projects-core';
import { deriveNextAction, type NextAction } from '@/dashboard/next-action';
import { USE_MOCK } from '@/mock/config';
import * as dashboardMock from '@/mock/domains/projects/dashboard';

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
  frozenBuild: number;
  auditIssues: number;
}

/** Artifact advancement order — the furthest-along kind wins as "latest". */
const KIND_RANK: Record<ArtifactKind, number> = {
  exploration_brief: 0,
  exploration: 1,
  spec: 2,
  plan: 3,
};

export async function dashboardProjects(
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<DashboardProject[]> {
  if (USE_MOCK) return dashboardMock.dashboardProjects();
  const db: Db = deps.db ?? getDb();
  const base = await visibleProjects(actor, { db });
  if (base.length === 0) return [];
  const ids = base.map((p) => p.id);

  // Awaiting-human: component_section (ai && !human && !forced) → component → stage → project.
  const awaitingRows = await db
    .select({ projectId: stage.projectId, n: sql<number>`count(*)::int` })
    .from(componentSection)
    .innerJoin(component, eq(componentSection.componentId, component.id))
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(
      and(
        inArray(stage.projectId, ids),
        eq(componentSection.aiSatisfied, true),
        eq(componentSection.humanSatisfied, false),
        eq(componentSection.forced, false),
      ),
    )
    .groupBy(stage.projectId);
  const awaitingByP = new Map(awaitingRows.map((r) => [r.projectId, Number(r.n)]));

  // Open audit issues: latest pass per (project, scope); count findings where verdict = revised.
  const passes = await db
    .select({
      projectId: auditPass.projectId,
      scope: auditPass.scope,
      passNo: auditPass.passNo,
      findingsCount: auditPass.findingsCount,
      verdict: auditPass.verdict,
    })
    .from(auditPass)
    .where(inArray(auditPass.projectId, ids));
  const latestPass = new Map<string, { findingsCount: number; verdict: string }>();
  const passNoSeen = new Map<string, number>();
  for (const p of passes) {
    const k = `${p.projectId}:${p.scope}`;
    if (p.passNo >= (passNoSeen.get(k) ?? -1)) {
      passNoSeen.set(k, p.passNo);
      latestPass.set(k, { findingsCount: p.findingsCount, verdict: p.verdict });
    }
  }
  const auditByP = new Map<string, number>();
  for (const [k, v] of latestPass) {
    if (v.verdict === 'revised') {
      const pid = k.slice(0, k.lastIndexOf(':'));
      auditByP.set(pid, (auditByP.get(pid) ?? 0) + v.findingsCount);
    }
  }

  // Agents running: running mma batches + running exploration tasks.
  const agentsByP = new Map<string, number>();
  const add = (pid: string, n: number) => agentsByP.set(pid, (agentsByP.get(pid) ?? 0) + n);
  const mmaRun = await db
    .select({ projectId: mmaBatch.projectId, n: sql<number>`count(*)::int` })
    .from(mmaBatch)
    .where(and(inArray(mmaBatch.projectId, ids), eq(mmaBatch.status, 'running')))
    .groupBy(mmaBatch.projectId);
  for (const r of mmaRun) add(r.projectId, Number(r.n));
  const taskRun = await db
    .select({ projectId: explorationTask.projectId, n: sql<number>`count(*)::int` })
    .from(explorationTask)
    .where(and(inArray(explorationTask.projectId, ids), eq(explorationTask.status, 'running')))
    .groupBy(explorationTask.projectId);
  for (const r of taskRun) add(r.projectId, Number(r.n));

  // Latest artifact: furthest-along kind, highest version.
  const arts = await db
    .select({ projectId: artifact.projectId, kind: artifact.kind, version: artifact.version })
    .from(artifact)
    .where(inArray(artifact.projectId, ids));
  const artByP = new Map<string, { kind: ArtifactKind; version: number }>();
  for (const a of arts) {
    const cur = artByP.get(a.projectId);
    if (
      !cur ||
      KIND_RANK[a.kind] > KIND_RANK[cur.kind] ||
      (a.kind === cur.kind && a.version > cur.version)
    ) {
      artByP.set(a.projectId, { kind: a.kind, version: a.version });
    }
  }

  // Collaborators (members other than owner).
  const collabRows = await db
    .select({
      projectId: projectMember.projectId,
      role: projectMember.role,
      id: member.id,
      displayName: member.displayName,
      avatarTint: member.avatarTint,
    })
    .from(projectMember)
    .innerJoin(member, eq(projectMember.memberId, member.id))
    .where(inArray(projectMember.projectId, ids));
  const collabByP = new Map<string, DashboardCollaborator[]>();
  for (const r of collabRows) {
    if (r.role === 'owner') continue;
    const list = collabByP.get(r.projectId) ?? [];
    list.push({ id: r.id, displayName: r.displayName, avatarTint: r.avatarTint });
    collabByP.set(r.projectId, list);
  }

  return base.map((p) => {
    const awaitingHuman = awaitingByP.get(p.id) ?? 0;
    const openAuditIssues = auditByP.get(p.id) ?? 0;
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
    active: projects.filter((p) => p.phase !== 'done').length,
    awaitingHuman: projects.filter((p) => p.awaitingHuman > 0).length,
    agentsRunning: projects.filter((p) => p.agentsRunning > 0).length,
    frozenBuild: projects.filter((p) => p.phase === 'frozen' || p.phase === 'build').length,
    auditIssues: projects.filter((p) => p.openAuditIssues > 0).length,
  };
}
