// @vitest-environment node
// Live-DB fixtures for Spec-8 export tests. Throwaway rows use a distinct prefix
// so cleanup is exhaustive; project ON DELETE CASCADE clears
// stage/component/artifact/audit_pass/mma_batch/export/project_member.
import { sql, inArray, eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema/identity';
import { project, stage, projectMember } from '@/db/schema/projects';
import { component } from '@/db/schema/spec';
import { artifact, auditPass } from '@/db/schema/artifacts';
import { mmaBatch } from '@/db/schema/mma';
import { exportRecord } from '@/db/schema/build';
import { actionLog } from '@/db/schema/audit';
import type { ArtifactKind, ComponentStatus, AuditVerdict, ProjectPhase } from '@/db/enums';

export const TEST_PREFIX = '__forge_export_test__';

function rnd(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function uniqueName(label = ''): string {
  return `${TEST_PREFIX}${label}_${rnd()}`;
}

export async function seedMember(label = 'm', displayName?: string): Promise<{ id: string }> {
  const db = getDb();
  const username = uniqueName(label);
  const [m] = await db
    .insert(member)
    .values({ username, displayName: displayName ?? username })
    .returning({ id: member.id });
  return { id: m.id };
}

export interface SeedProjectResult {
  projectId: string;
  ownerId: string;
  specStageId: string;
}

export async function seedProject(opts?: {
  visibility?: 'public' | 'private';
  phase?: ProjectPhase;
  ownerDisplayName?: string;
  summary?: string | null;
}): Promise<SeedProjectResult> {
  const db = getDb();
  const owner = await seedMember('owner', opts?.ownerDisplayName);
  const name = uniqueName('p');
  const [proj] = await db
    .insert(project)
    .values({
      name,
      visibility: opts?.visibility ?? 'public',
      phase: opts?.phase ?? 'design',
      currentStage: 'spec',
      ownerId: owner.id,
      summary: opts?.summary ?? 'A short project summary.',
      intentMd: 'Build a thing.',
    })
    .returning({ id: project.id });

  await db.insert(stage).values(
    (['exploration', 'spec', 'plan', 'execute', 'review'] as const).map((kind) => ({
      projectId: proj.id,
      kind,
      status: (kind === 'spec' ? 'active' : 'pending') as 'active' | 'pending',
    })),
  );
  await db.insert(projectMember).values({ projectId: proj.id, memberId: owner.id, role: 'owner' });

  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, proj.id), eq(stage.kind, 'spec')))
    .limit(1);

  return { projectId: proj.id, ownerId: owner.id, specStageId: specStage.id };
}

export async function seedArtifact(
  projectId: string,
  kind: ArtifactKind,
  bodyMd: string,
  version = 1,
): Promise<{ id: string }> {
  const db = getDb();
  const [a] = await db
    .insert(artifact)
    .values({ projectId, kind, bodyMd, version })
    .returning({ id: artifact.id });
  return { id: a.id };
}

export async function seedComponent(
  specStageId: string,
  kind: 'context' | 'problem' | 'tech_design' | 'test_plan' | 'stories_tasks' | 'nfr' | 'assumptions',
  status: ComponentStatus,
  primaryRoles: string[],
  orderIndex: number,
): Promise<void> {
  const db = getDb();
  await db.insert(component).values({ stageId: specStageId, kind, status, primaryRoles, orderIndex });
}

export async function seedAuditPass(
  projectId: string,
  scope: 'spec' | 'plan',
  verdict: AuditVerdict,
  passNo: number,
): Promise<void> {
  const db = getDb();
  await db.insert(auditPass).values({ projectId, scope, passNo, findingsCount: 0, verdict });
}

export async function seedReviewBatch(
  projectId: string,
  result: unknown,
  status: 'done' | 'running' = 'done',
): Promise<void> {
  const db = getDb();
  await db.insert(mmaBatch).values({
    projectId,
    route: 'review',
    cwd: '/workspace/x',
    status,
    request: {},
    result: result as object,
  });
}

/** Delete every throwaway row this fixture set created (FK-safe). */
export async function cleanupExportFixtures(): Promise<void> {
  const db = getDb();
  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(sql`${project.name} LIKE ${TEST_PREFIX + '%'}`);
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length > 0) {
    await db.delete(exportRecord).where(inArray(exportRecord.projectId, projectIds));
    await db.delete(actionLog).where(inArray(actionLog.projectId, projectIds));
  }
  const members = await db
    .select({ id: member.id })
    .from(member)
    .where(sql`${member.username} LIKE ${TEST_PREFIX + '%'}`);
  const memberIds = members.map((m) => m.id);
  if (memberIds.length > 0) {
    await db.delete(actionLog).where(inArray(actionLog.memberId, memberIds));
  }
  await db.delete(project).where(sql`${project.name} LIKE ${TEST_PREFIX + '%'}`);
  await db.delete(member).where(sql`${member.username} LIKE ${TEST_PREFIX + '%'}`);
}
