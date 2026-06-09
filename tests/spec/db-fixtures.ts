// @vitest-environment node
// Shared live-DB fixtures for Spec-4 (Spec stage) integration tests. Throwaway
// rows use distinct prefixes so cleanup is exhaustive. project ON DELETE CASCADE
// clears stage/component/component_section/qa_message/artifact/audit_pass/
// learning_candidate; action_log + project_repo are cleaned explicitly.
import { sql, inArray, eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema/identity';
import { project, stage, projectMember } from '@/db/schema/projects';
import { actionLog } from '@/db/schema/audit';

export const TEST_PROJECT_PREFIX = '__forge_spec_test__';
export const TEST_MEMBER_PREFIX = '__forge_spec_member__';

function rnd(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueName(prefix: string, label = ''): string {
  return `${prefix}${label}_${rnd()}`;
}

/** Insert a throwaway member; returns its id. */
export async function seedMember(label = 'm'): Promise<{ id: string }> {
  const db = getDb();
  const username = uniqueName(TEST_MEMBER_PREFIX, label);
  const [m] = await db
    .insert(member)
    .values({ username, displayName: username })
    .returning({ id: member.id });
  return { id: m.id };
}

/**
 * Insert a throwaway project (public by default) + its five seeded stage rows.
 * Returns the project id, owner id, and the spec stage id.
 */
export async function seedProject(opts?: {
  visibility?: 'public' | 'private';
  intentMd?: string | null;
}): Promise<{ projectId: string; ownerId: string; specStageId: string }> {
  const db = getDb();
  const owner = await seedMember('owner');
  const name = uniqueName(TEST_PROJECT_PREFIX, 'p');
  const [proj] = await db
    .insert(project)
    .values({
      name,
      visibility: opts?.visibility ?? 'public',
      phase: 'design',
      currentStage: 'spec',
      ownerId: owner.id,
      intentMd: opts?.intentMd ?? 'Build a thing that does the job well.',
    })
    .returning({ id: project.id });

  // Seed the five stages (Spec 3 does this on create; we insert directly here).
  await db.insert(stage).values(
    (['exploration', 'spec', 'plan', 'execute', 'review'] as const).map((kind) => ({
      projectId: proj.id,
      kind,
      status: (kind === 'spec' ? 'active' : 'pending') as 'active' | 'pending',
      startedAt: kind === 'spec' ? new Date() : null,
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

/** Delete every throwaway row created by these fixtures (FK-safe order). */
export async function cleanupSpecFixtures(): Promise<void> {
  const db = getDb();

  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length > 0) {
    await db.delete(actionLog).where(inArray(actionLog.projectId, projectIds));
  }

  const members = await db
    .select({ id: member.id })
    .from(member)
    .where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
  const memberIds = members.map((m) => m.id);
  if (memberIds.length > 0) {
    await db.delete(actionLog).where(inArray(actionLog.memberId, memberIds));
  }

  // project cascade clears stage/component/component_section/qa_message/
  // artifact/audit_pass/learning_candidate/project_member.
  await db.delete(project).where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);
  await db.delete(member).where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
}
