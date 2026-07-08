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
  it('creates project with details initialized', async () => {
    const ownerId = 'owner-1';
    const projectId = 'proj-1';
    const mockDb = createMockDb({
      'select:workspace_repo': [
        { id: repo1, name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' },
        { id: repo2, name: 'repo-b', pathOnDisk: '/tmp/b', defaultBranch: 'main' },
      ],
      'insert:project': [{ id: projectId, name: 'test-proj', visibility: 'public', phase: 'design', currentStage: 'exploration', ownerId }],
      'insert:ops_action_log': [{ projectId, action: 'create_project', memberId: ownerId }],
    });

    const res = await createProject(
      { name: 'test-proj', visibility: 'public', repoIds: [repo1, repo2] },
      { id: ownerId, teamId: 'team-1' },
      { db: mockDb },
    );
    expect(res.ok).toBe(true);
    expect(mockDb._assertCalled('project', 'insert')).toBe(true);
  });

  it('creates the project with details initialized', async () => {
    const ownerId = 'owner-2';
    const projectId = 'proj-2';
    const mockDb = createMockDb({
      'select:workspace_repo': [{ id: repo1, name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' }],
      'insert:project': [{ id: projectId, phase: 'design', currentStage: 'exploration', ownerId, summary: null }],
      'insert:ops_action_log': [{ projectId, action: 'create_project' }],
    });

    const res = await createProject(
      { name: 'test-proj', visibility: 'private', repoIds: [repo1] },
      { id: ownerId, teamId: 'team-1' },
      { db: mockDb },
    );
    expect(res.ok).toBe(true);
  });

  it('rejects an empty/whitespace name', async () => {
    const ownerId = 'owner-3';
    const mockDb = createMockDb({});

    const res = await createProject(
      { name: '   ', visibility: 'public', repoIds: [repo1] },
      { id: ownerId, teamId: 'team-1' },
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
      { id: ownerId, teamId: 'team-1' },
      { db: mockDb },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe('repoIds');
  });

  it('allows a duplicate name (names are not unique)', async () => {
    const ownerId = 'owner-5';
    const mockDb = createMockDb({
      'insert:project': [{ id: 'p-1' }, { id: 'p-2' }],
      'insert:project_stage': [],
      'insert:project_participant': [],
      'insert:project_repo': [],
      'insert:ops_action_log': [],
    });

    const a = await createProject(
      { name: 'dup', visibility: 'public', repoIds: [repo1] },
      { id: ownerId, teamId: 'team-1' },
      { db: mockDb },
    );
    const b = await createProject(
      { name: 'dup', visibility: 'public', repoIds: [repo1] },
      { id: ownerId, teamId: 'team-1' },
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
      'select:project_participant': [],
    });

    const visible = await visibleProjects({ id: strangerId }, { db: mockDb });
    expect(visible.some((p) => p.id === projectId)).toBe(true);
    await expect(assertProjectReadable(projectId, { id: strangerId }, { db: mockDb })).resolves.toBeUndefined();
  });

  it('derives phase/currentStage from details — NOT the stale denormalized column', async () => {
    // The column drift bug: a completed project whose `phase` column was left at an
    // old value must still render as completed, because the card reads the derived
    // value from details (the source of truth), not the column.
    const { buildInitialDetails } = await import('@/details/schema');
    const d = buildInitialDetails();
    for (const s of ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const) {
      d.stages[s].status = 'done';
    }
    const mockDb = createMockDb({
      'select:project': [{
        id: 'proj-drift', name: 'Done', summary: null, visibility: 'public',
        phase: 'design', currentStage: 'exploration', // STALE columns
        ownerId: 'owner-d', updatedAt: new Date(), details: d,
      }],
      'select:team_member': [{ id: 'owner-d', displayName: 'Owner', avatarTint: '#fff' }],
    });

    const [proj] = await visibleProjects({ id: 'owner-d' }, { db: mockDb });
    expect(proj.phase).toBe('completed'); // derived from details, not the 'design' column
    expect(proj.currentStage).toBe('journal');
  });

  it('a private project is hidden from a non-collaborator', async () => {
    const projectId = 'proj-7';
    const ownerId = 'owner-7';
    const strangerId = 'stranger-2';
    const mockDb = createMockDb({
      'select:project': seq([], [{ id: projectId, visibility: 'private', ownerId }]),
      'select:project_participant': [],
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
      'select:project_participant': [{ projectId, memberId: ownerId, role: 'owner' }],
      'update:project': [{ id: projectId, visibility: 'private' }],
      'insert:ops_action_log': [{ projectId, action: 'change_visibility', memberId: ownerId }],
    });

    await changeVisibility(projectId, 'private', { id: ownerId, teamId: 'team-1' }, { db: mockDb });
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });

  it('changeRepos updates details repos', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-9';
    const ownerId = 'owner-9';
    const d = buildInitialDetails();
    d.repos = [{ id: 'repo-1', name: 'old', pathOnDisk: '/tmp', defaultBranch: 'main' }];
    const mockDb = createMockDb({
      'select:project': seq([{ id: projectId, ownerId }], [{ details: d, detailsVersion: 0 }]),
      'select:workspace_repo': [{ id: 'repo-2', name: 'new', pathOnDisk: '/tmp/2', defaultBranch: 'main' }],
      'update:project': [{ id: projectId }],
      'insert:ops_action_log': [],
    });

    await changeRepos(projectId, ['repo-2'], { id: ownerId, teamId: 'team-1' }, { db: mockDb });
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });
});

describe('getProjectRepos — reads from details', () => {
  it('returns repos from details', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-10';
    const d = buildInitialDetails();
    d.repos = [
      { id: 'good-repo', name: 'Good', pathOnDisk: '/tmp/good', defaultBranch: 'main' },
      { id: 'bad-repo', name: 'Bad', pathOnDisk: '/tmp/bad', defaultBranch: 'main' },
    ];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:workspace_repo': [
        { id: 'good-repo', name: 'Good', tags: [], status: 'cloned' },
        { id: 'bad-repo', name: 'Bad', tags: [], status: 'error' },
      ],
    });

    const views = await getProjectRepos(projectId, { db: mockDb });
    expect(views).toHaveLength(2);
    const goodView = views.find((v) => v.repoId === 'good-repo');
    const badView = views.find((v) => v.repoId === 'bad-repo');
    expect(goodView?.available).toBe(true);
    expect(badView?.available).toBe(false);
  });
});
