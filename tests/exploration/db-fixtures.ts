// @vitest-environment node
// Shared live-DB fixtures for Spec-5 (Exploration) integration tests. Throwaway
// rows use distinct prefixes so cleanup is exhaustive. project ON DELETE CASCADE
// clears stage/exploration_task/attachment/mma_batch/artifact; action_log +
// repo are cleaned explicitly.
import { sql, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema/identity';
import { project, stage, projectMember, projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { actionLog } from '@/db/schema/audit';

export const TEST_PROJECT_PREFIX = '__forge_explore_test__';
export const TEST_MEMBER_PREFIX = '__forge_explore_member__';
export const TEST_REPO_PREFIX = '__forge_explore_repo__';

function rnd(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function uniqueName(prefix: string, label = ''): string {
  return `${prefix}${label}_${rnd()}`;
}

export async function seedMember(label = 'm'): Promise<{ id: string }> {
  const db = getDb();
  const username = uniqueName(TEST_MEMBER_PREFIX, label);
  const [m] = await db
    .insert(member)
    .values({ username, displayName: username })
    .returning({ id: member.id });
  return { id: m.id };
}

export async function seedRepo(label = 'r', pathOnDisk = '/work/repo'): Promise<{ id: string; pathOnDisk: string }> {
  const db = getDb();
  const name = uniqueName(TEST_REPO_PREFIX, label);
  const [r] = await db
    .insert(repo)
    .values({ name, pathOnDisk, defaultBranch: 'main', kind: 'service' })
    .returning({ id: repo.id, pathOnDisk: repo.pathOnDisk });
  return { id: r.id, pathOnDisk: r.pathOnDisk };
}

/**
 * Seed a throwaway project (public by default) + five seeded stages + owner row.
 * Optionally attach repos to the project's repo subset.
 */
export async function seedProject(opts?: {
  visibility?: 'public' | 'private';
  repoIds?: string[];
}): Promise<{ projectId: string; ownerId: string }> {
  const db = getDb();
  const owner = await seedMember('owner');
  const name = uniqueName(TEST_PROJECT_PREFIX, 'p');
  const [proj] = await db
    .insert(project)
    .values({
      name,
      visibility: opts?.visibility ?? 'public',
      phase: 'design',
      currentStage: 'exploration',
      ownerId: owner.id,
    })
    .returning({ id: project.id });

  await db.insert(stage).values(
    (['exploration', 'spec', 'plan', 'execute', 'review'] as const).map((kind) => ({
      projectId: proj.id,
      kind,
      status: (kind === 'exploration' ? 'active' : 'pending') as 'active' | 'pending',
      startedAt: kind === 'exploration' ? new Date() : null,
    })),
  );
  await db.insert(projectMember).values({ projectId: proj.id, memberId: owner.id, role: 'owner' });
  if (opts?.repoIds?.length) {
    await db.insert(projectRepo).values(opts.repoIds.map((repoId) => ({ projectId: proj.id, repoId })));
  }

  return { projectId: proj.id, ownerId: owner.id };
}

export async function cleanupExploreFixtures(): Promise<void> {
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

  // project cascade clears stage/exploration_task/attachment/mma_batch/artifact/
  // project_member/project_repo.
  await db.delete(project).where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);
  await db.delete(repo).where(sql`${repo.name} LIKE ${TEST_REPO_PREFIX + '%'}`);
  await db.delete(member).where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
}
