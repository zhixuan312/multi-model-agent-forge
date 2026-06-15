// @vitest-environment node
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project, projectRepo, projectMember, stage } from '@/db/schema/projects';
import { actionLog } from '@/db/schema/audit';
import {
  createProject,
  visibleProjects,
  assertProjectReadable,
  readProjectArtifacts,
  readProjectRepos,
  changeVisibility,
  changeRepos,
  getProjectRepos,
  ProjectAccessError,
} from '@/projects/projects-core';
import {
  seedMember,
  seedRepo,
  cleanupProjectsFixtures,
  TEST_PROJECT_PREFIX,
} from './db-fixtures';

const pname = (label: string) => `${TEST_PROJECT_PREFIX}${label}`;

afterAll(async () => {
  await cleanupProjectsFixtures();
});

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('createProject — seeding + validation', () => {
  it('seeds exactly 5 stage rows in STAGE_ORDER, exploration active, rest pending', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const r2 = await seedRepo();
    const res = await createProject(
      { name: pname('seed'), visibility: 'public', repoIds: [r1.id, r2.id] },
      { id: owner.id },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const db = getDb();
    const stages = await db
      .select({ kind: stage.kind, status: stage.status })
      .from(stage)
      .where(eq(stage.projectId, res.id));
    expect(stages).toHaveLength(5);
    const byKind = Object.fromEntries(stages.map((s) => [s.kind, s.status]));
    expect(byKind).toEqual({
      exploration: 'active',
      spec: 'pending',
      plan: 'pending',
      execute: 'pending',
      review: 'pending',
    });
  });

  it('creates the project with phase=design, current_stage=exploration, owner set, summary NULL', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('row'), visibility: 'private', repoIds: [r1.id] },
      { id: owner.id },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const db = getDb();
    const [row] = await db.select().from(project).where(eq(project.id, res.id));
    expect(row.phase).toBe('design');
    expect(row.currentStage).toBe('exploration');
    expect(row.ownerId).toBe(owner.id);
    expect(row.summary).toBeNull();
    expect(row.intentMd).toBeNull();
  });

  it('seeds one owner project_member row + one project_repo per repo, in the same tx', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const r2 = await seedRepo();
    const res = await createProject(
      { name: pname('members'), visibility: 'public', repoIds: [r1.id, r2.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    const db = getDb();
    const members = await db
      .select()
      .from(projectMember)
      .where(eq(projectMember.projectId, res.id));
    expect(members).toHaveLength(1);
    expect(members[0].memberId).toBe(owner.id);
    expect(members[0].role).toBe('owner');
    const repos = await db.select().from(projectRepo).where(eq(projectRepo.projectId, res.id));
    expect(repos.map((r) => r.repoId).sort()).toEqual([r1.id, r2.id].sort());
  });

  it('writes one create_project action_log row with the actor + project target', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('log'), visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    const db = getDb();
    const logs = await db.select().from(actionLog).where(eq(actionLog.projectId, res.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('create_project');
    expect(logs[0].memberId).toBe(owner.id);
    expect(logs[0].target).toBe(`project:${res.id}`);
  });

  it('rejects an empty/whitespace name (no project row created)', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: '   ', visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe('name');
  });

  it('rejects zero repoIds (no project row created)', async () => {
    const owner = await seedMember('owner');
    const res = await createProject(
      { name: pname('norepo'), visibility: 'public', repoIds: [] },
      { id: owner.id },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe('repoIds');
  });

  it('allows a duplicate name (names are not unique)', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const dup = pname('dup');
    const a = await createProject({ name: dup, visibility: 'public', repoIds: [r1.id] }, { id: owner.id });
    const b = await createProject({ name: dup, visibility: 'public', repoIds: [r1.id] }, { id: owner.id });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe.skipIf(!hasDb)('visibility — visibleProjects + assertProjectReadable', () => {
  it('a public project is visible to a non-member and assertProjectReadable passes', async () => {
    const owner = await seedMember('owner');
    const stranger = await seedMember('stranger');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('pub'), visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    const visible = await visibleProjects({ id: stranger.id });
    expect(visible.some((p) => p.id === res.id)).toBe(true);
    await expect(assertProjectReadable(res.id, { id: stranger.id })).resolves.toBeUndefined();
  });

  it('a private project is hidden from a non-collaborator and assertProjectReadable throws', async () => {
    const owner = await seedMember('owner');
    const stranger = await seedMember('stranger');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('priv'), visibility: 'private', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    const visible = await visibleProjects({ id: stranger.id });
    expect(visible.some((p) => p.id === res.id)).toBe(false);
    await expect(assertProjectReadable(res.id, { id: stranger.id })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
  });

  it('owner + collaborator both pass the guard and see a private project', async () => {
    const owner = await seedMember('owner');
    const collab = await seedMember('collab');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('privcollab'), visibility: 'private', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    // add the collaborator
    await getDb().insert(projectMember).values({ projectId: res.id, memberId: collab.id, role: 'collaborator' });

    await expect(assertProjectReadable(res.id, { id: owner.id })).resolves.toBeUndefined();
    await expect(assertProjectReadable(res.id, { id: collab.id })).resolves.toBeUndefined();
    const ownerList = await visibleProjects({ id: owner.id });
    const collabList = await visibleProjects({ id: collab.id });
    expect(ownerList.some((p) => p.id === res.id)).toBe(true);
    expect(collabList.some((p) => p.id === res.id)).toBe(true);
  });

  it('flipping public→private drops it from a non-collaborator list on the next read', async () => {
    const owner = await seedMember('owner');
    const stranger = await seedMember('stranger');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('flip'), visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    expect((await visibleProjects({ id: stranger.id })).some((p) => p.id === res.id)).toBe(true);
    await changeVisibility(res.id, 'private', { id: owner.id });
    expect((await visibleProjects({ id: stranger.id })).some((p) => p.id === res.id)).toBe(false);
  });

  it('hides artifacts, not code: readProjectArtifacts throws for a non-collaborator; readProjectRepos does not', async () => {
    const owner = await seedMember('owner');
    const stranger = await seedMember('stranger');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('artvscode'), visibility: 'private', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    await expect(readProjectArtifacts(res.id, { id: stranger.id })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
    const repos = await readProjectRepos(res.id);
    expect(repos.map((r) => r.repoId)).toEqual([r1.id]);
  });
});

describe.skipIf(!hasDb)('mutation authorization', () => {
  it('changeVisibility by a non-owner is rejected and writes no log row', async () => {
    const owner = await seedMember('owner');
    const other = await seedMember('collab');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('authz'), visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    // make `other` a collaborator so they pass the READ guard but fail the OWNER gate
    await getDb().insert(projectMember).values({ projectId: res.id, memberId: other.id, role: 'collaborator' });

    await expect(changeVisibility(res.id, 'private', { id: other.id })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
    const db = getDb();
    const [row] = await db.select().from(project).where(eq(project.id, res.id));
    expect(row.visibility).toBe('public'); // unchanged
    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, res.id), eq(actionLog.action, 'change_visibility')));
    expect(logs).toHaveLength(0);
  });

  it('changeVisibility by the owner succeeds and writes one log row', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const res = await createProject(
      { name: pname('ownerflip'), visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    await changeVisibility(res.id, 'private', { id: owner.id });
    const db = getDb();
    const [row] = await db.select().from(project).where(eq(project.id, res.id));
    expect(row.visibility).toBe('private');
    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, res.id), eq(actionLog.action, 'change_visibility')));
    expect(logs).toHaveLength(1);
  });

  it('changeRepos by an equal-rights member succeeds and logs; reducing to zero is rejected', async () => {
    const owner = await seedMember('owner');
    const r1 = await seedRepo();
    const r2 = await seedRepo();
    const res = await createProject(
      { name: pname('repos'), visibility: 'public', repoIds: [r1.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    await changeRepos(res.id, [r1.id, r2.id], { id: owner.id });
    const db = getDb();
    const repos = await db.select().from(projectRepo).where(eq(projectRepo.projectId, res.id));
    expect(repos.map((r) => r.repoId).sort()).toEqual([r1.id, r2.id].sort());
    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, res.id), eq(actionLog.action, 'change_repos')));
    expect(logs).toHaveLength(1);

    await expect(changeRepos(res.id, [], { id: owner.id })).rejects.toBeInstanceOf(ProjectAccessError);
  });
});

describe.skipIf(!hasDb)('getProjectRepos — dangling + errored repo resolution', () => {
  it('marks an errored repo unavailable; a resolvable repo available', async () => {
    const owner = await seedMember('owner');
    const good = await seedRepo({ status: 'cloned' });
    const bad = await seedRepo({ status: 'error' });
    const res = await createProject(
      { name: pname('repostate'), visibility: 'public', repoIds: [good.id, bad.id] },
      { id: owner.id },
    );
    if (!res.ok) throw new Error('create failed');
    const views = await getProjectRepos(res.id);
    const goodView = views.find((v) => v.repoId === good.id);
    const badView = views.find((v) => v.repoId === bad.id);
    expect(goodView?.available).toBe(true);
    expect(badView?.available).toBe(false);

    // resolvable count in the list DTO excludes the errored repo
    const list = await visibleProjects({ id: owner.id });
    const item = list.find((p) => p.id === res.id);
    expect(item?.repoCount).toBe(1);
  });
});
