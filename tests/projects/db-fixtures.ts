// @vitest-environment node
// Shared live-DB fixtures for Projects (Spec 3) integration tests. Throwaway
// rows use distinct prefixes so cleanup is exhaustive and never touches real
// data. project ON DELETE CASCADE clears stage/project_repo/project_member;
// action_log + project_repo are cleaned explicitly (no cascade from member/repo).
import { sql, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import { project, projectRepo } from '@/db/schema/projects';
import { actionLog } from '@/db/schema/audit';

export const TEST_PROJECT_PREFIX = '__forge_proj_test__';
export const TEST_REPO_PREFIX = '__forge_proj_repo__';
export const TEST_MEMBER_PREFIX = '__forge_proj_member__';

function rnd(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueName(prefix: string, label = ''): string {
  return `${prefix}${label}_${rnd()}`;
}

/** Insert a throwaway member; returns its id + username. */
export async function seedMember(label = 'm'): Promise<{ id: string; username: string }> {
  const db = getDb();
  const username = uniqueName(TEST_MEMBER_PREFIX, label);
  const [m] = await db
    .insert(member)
    .values({ username, displayName: username })
    .returning({ id: member.id });
  return { id: m.id, username };
}

/** Insert a throwaway repo; returns its id. `status` defaults to 'cloned'. */
export async function seedRepo(opts?: {
  label?: string;
  kind?: string;
  tags?: string[];
  status?: 'cloned' | 'pulling' | 'error';
}): Promise<{ id: string; name: string }> {
  const db = getDb();
  const name = uniqueName(TEST_REPO_PREFIX, opts?.label ?? 'r');
  const [r] = await db
    .insert(repo)
    .values({
      name,
      pathOnDisk: `/tmp/${name}`,
      defaultBranch: 'main',
      kind: opts?.kind ?? 'service',
      tags: opts?.tags ?? [],
      status: opts?.status ?? 'cloned',
    })
    .returning({ id: repo.id });
  return { id: r.id, name };
}

/** Delete every throwaway row created by these fixtures (FK-safe order). */
export async function cleanupProjectsFixtures(): Promise<void> {
  const db = getDb();

  // Collect throwaway project ids (named with the prefix).
  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);
  const projectIds = projects.map((p) => p.id);

  // action_log rows for those projects (no cascade from project on action_log).
  if (projectIds.length > 0) {
    await db.delete(actionLog).where(inArray(actionLog.projectId, projectIds));
  }

  // action_log rows authored by throwaway members (team-level / null-project rows).
  const members = await db
    .select({ id: member.id })
    .from(member)
    .where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
  const memberIds = members.map((m) => m.id);
  if (memberIds.length > 0) {
    await db.delete(actionLog).where(inArray(actionLog.memberId, memberIds));
  }

  // project_repo rows referencing throwaway repos (no cascade from repo).
  const repos = await db
    .select({ id: repo.id })
    .from(repo)
    .where(sql`${repo.name} LIKE ${TEST_REPO_PREFIX + '%'}`);
  const repoIds = repos.map((r) => r.id);
  if (repoIds.length > 0) {
    await db.delete(projectRepo).where(inArray(projectRepo.repoId, repoIds));
  }

  // Projects cascade-clear stage / project_repo / project_member.
  await db.delete(project).where(sql`${project.name} LIKE ${TEST_PROJECT_PREFIX + '%'}`);

  // Repos + members last (now unreferenced).
  await db.delete(repo).where(sql`${repo.name} LIKE ${TEST_REPO_PREFIX + '%'}`);
  await db.delete(member).where(sql`${member.username} LIKE ${TEST_MEMBER_PREFIX + '%'}`);
}
