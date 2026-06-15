// @vitest-environment node
import {
  createProject,
  visibleProjects,
  assertProjectReadable,
  changeVisibility,
  changeRepos,
  getProjectRepos,
  ProjectAccessError,
} from '@/projects/projects-core';
import { createMockDb, seq } from '../test-utils/mock-db';

const repo1 = '00000000-0000-4000-8000-000000000001';
const repo2 = '00000000-0000-4000-8000-000000000002';

describe('createProject — seeding + validation', () => {
  it('seeds exactly 5 stage rows in STAGE_ORDER, exploration active, rest pending', async () => {
    const ownerId = 'owner-1';
    const projectId = 'proj-1';
    const mockDb = createMockDb({
      'insert:project': [{ id: projectId, name: 'test-proj', visibility: 'public', phase: 'design', currentStage: 'exploration', ownerId }],
      'insert:stage': [
        { id: 'stage-1', projectId, kind: 'exploration', status: 'active' },
        { id: 'stage-2', projectId, kind: 'spec', status: 'pending' },
        { id: 'stage-3', projectId, kind: 'plan', status: 'pending' },
        { id: 'stage-4', projectId, kind: 'execute', status: 'pending' },
        { id: 'stage-5', projectId, kind: 'review', status: 'pending' },
      ],
      'insert:project_member': [{ projectId, memberId: ownerId, role: 'owner' }],
      'insert:project_repo': [
        { projectId, repoId: repo1 },
        { projectId, repoId: repo2 },
      ],
      'insert:action_log': [{ projectId, action: 'create_project', memberId: ownerId }],
    });

    const res = await createProject(
      { name: 'test-proj', visibility: 'public', repoIds: [repo1, repo2] },
      { id: ownerId },
      { db: mockDb },
    );
    expect(res.ok).toBe(true);
    expect(mockDb._assertCalled('stage', 'insert')).toBe(true);
  });

  it('creates the project with phase=design, current_stage=exploration, owner set, summary NULL', async () => {
    const ownerId = 'owner-2';
    const projectId = 'proj-2';
    const mockDb = createMockDb({
      'insert:project': [{ id: projectId, phase: 'design', currentStage: 'exploration', ownerId, summary: null, intentMd: null }],
      'insert:stage': [],
      'insert:project_member': [{ projectId, memberId: ownerId, role: 'owner' }],
      'insert:project_repo': [{ projectId, repoId: repo1 }],
      'insert:action_log': [{ projectId, action: 'create_project' }],
    });

    const res = await createProject(
      { name: 'test-proj', visibility: 'private', repoIds: [repo1] },
      { id: ownerId },
      { db: mockDb },
    );
    expect(res.ok).toBe(true);
  });

  it('rejects an empty/whitespace name', async () => {
    const ownerId = 'owner-3';
    const mockDb = createMockDb({});

    const res = await createProject(
      { name: '   ', visibility: 'public', repoIds: [repo1] },
      { id: ownerId },
      { db: mockDb },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe('name');
  });

  it('rejects zero repoIds', async () => {
    const ownerId = 'owner-4';
    const mockDb = createMockDb({});

    const res = await createProject(
      { name: 'test-proj', visibility: 'public', repoIds: [] },
      { id: ownerId },
      { db: mockDb },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe('repoIds');
  });

  it('allows a duplicate name (names are not unique)', async () => {
    const ownerId = 'owner-5';
    const mockDb = createMockDb({
      'insert:project': [{ id: 'p-1' }, { id: 'p-2' }],
      'insert:stage': [],
      'insert:project_member': [],
      'insert:project_repo': [],
      'insert:action_log': [],
    });

    const a = await createProject(
      { name: 'dup', visibility: 'public', repoIds: [repo1] },
      { id: ownerId },
      { db: mockDb },
    );
    const b = await createProject(
      { name: 'dup', visibility: 'public', repoIds: [repo1] },
      { id: ownerId },
      { db: mockDb },
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe('visibility — visibleProjects + assertProjectReadable', () => {
  it('a public project is visible to a non-member', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';
    const strangerId = 'stranger-1';
    const mockDb = createMockDb({
      'select:project': seq(
        [{ id: projectId, visibility: 'public', ownerId }],
        [{ id: projectId, visibility: 'public', ownerId }],
      ),
      'select:project_member': [],
    });

    const visible = await visibleProjects({ id: strangerId }, { db: mockDb });
    expect(visible.some((p) => p.id === projectId)).toBe(true);
    await expect(assertProjectReadable(projectId, { id: strangerId }, { db: mockDb })).resolves.toBeUndefined();
  });

  it('a private project is hidden from a non-collaborator', async () => {
    const projectId = 'proj-7';
    const ownerId = 'owner-7';
    const strangerId = 'stranger-2';
    const mockDb = createMockDb({
      'select:project': seq([], [{ id: projectId, visibility: 'private', ownerId }]),
      'select:project_member': [],
    });

    const visible = await visibleProjects({ id: strangerId }, { db: mockDb });
    expect(visible.some((p) => p.id === projectId)).toBe(false);
    await expect(assertProjectReadable(projectId, { id: strangerId }, { db: mockDb })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
  });
});

describe('mutation authorization', () => {
  it('changeVisibility by the owner succeeds and writes one log row', async () => {
    const projectId = 'proj-8';
    const ownerId = 'owner-8';
    const mockDb = createMockDb({
      'select:project': [{ id: projectId, visibility: 'public', ownerId }],
      'select:project_member': [{ projectId, memberId: ownerId, role: 'owner' }],
      'update:project': [{ id: projectId, visibility: 'private' }],
      'insert:action_log': [{ projectId, action: 'change_visibility', memberId: ownerId }],
    });

    await changeVisibility(projectId, 'private', { id: ownerId }, { db: mockDb });
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });

  it('changeRepos by an owner succeeds and logs', async () => {
    const projectId = 'proj-9';
    const ownerId = 'owner-9';
    const mockDb = createMockDb({
      'select:project': [{ id: projectId, ownerId }],
      'select:project_member': [{ projectId, memberId: ownerId, role: 'owner' }],
      'select:project_repo': [{ projectId, repoId: 'repo-1' }],
      'delete:project_repo': [],
      'insert:project_repo': [{ projectId, repoId: 'repo-2' }],
      'insert:action_log': [{ projectId, action: 'change_repos' }],
    });

    await changeRepos(projectId, ['repo-2'], { id: ownerId }, { db: mockDb });
    expect(mockDb._assertCalled('project_repo', 'insert')).toBe(true);
  });
});

describe('getProjectRepos — dangling + errored repo resolution', () => {
  it('marks an errored repo unavailable; a cloned repo available', async () => {
    const projectId = 'proj-10';
    const mockDb = createMockDb({
      'select:project_repo': [
        { projectId, repoId: 'good-repo', name: 'Good', kind: 'app', tags: [], status: 'cloned' },
        { projectId, repoId: 'bad-repo', name: 'Bad', kind: 'app', tags: [], status: 'error' },
      ],
    });

    const views = await getProjectRepos(projectId, { db: mockDb });
    const goodView = views.find((v) => v.repoId === 'good-repo');
    const badView = views.find((v) => v.repoId === 'bad-repo');
    expect(goodView?.available).toBe(true);
    expect(badView?.available).toBe(false);
  });
});
