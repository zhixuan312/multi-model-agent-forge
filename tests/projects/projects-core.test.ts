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

    const visible = await visibleProjects({ id: strangerId, teamId: 'team-1' }, { db: mockDb });
    expect(visible.some((p) => p.id === projectId)).toBe(true);
    await expect(assertProjectReadable(projectId, { id: strangerId, teamId: 'team-1' }, { db: mockDb })).resolves.toBeUndefined();
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

    const [proj] = await visibleProjects({ id: 'owner-d', teamId: 'team-1' }, { db: mockDb });
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

    const visible = await visibleProjects({ id: strangerId, teamId: 'team-1' }, { db: mockDb });
    expect(visible.some((p) => p.id === projectId)).toBe(false);
    await expect(assertProjectReadable(projectId, { id: strangerId, teamId: 'team-1' }, { db: mockDb })).rejects.toBeInstanceOf(
      ProjectAccessError,
    );
  });

  it('filters visibleProjects by actor.teamId', async () => {
    const db = createMockDb({
      'select:project': [{
        id: 'proj-1',
        teamId: 'team-a',
        visibility: 'public',
        ownerId: 'owner-a',
        name: 'A',
        summary: null,
        phase: 'design',
        currentStage: 'exploration',
        updatedAt: new Date(),
        details: null,
      }],
    });

    await visibleProjects({ id: 'owner-a', teamId: 'team-b' }, { db });
    expect(db._assertCalled('project', 'where')).toBe(true);
  });
});

describe('mutation authorization', () => {
  it('changeVisibility by the owner succeeds', async () => {
    const projectId = 'proj-8';
    const ownerId = 'owner-8';
    const mockDb = createMockDb({
      'select:project': [{ id: projectId, visibility: 'public', ownerId }],
      'select:project_participant': [{ projectId, memberId: ownerId, role: 'owner' }],
      'update:project': [{ id: projectId, visibility: 'private' }],
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

describe('createProject activity row', () => {
  it('records create_project with actor display fields loaded inside the transaction', async () => {
    const db = createMockDb({
      'select:workspace_repo': [{ id: '11111111-1111-4111-8111-111111111111', name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' }],
      'select:team_member': [{ id: 'owner-1', displayName: 'Owner', avatarTint: '#f60' }],
      'insert:project': [{ id: 'proj-1' }],
      'insert:project_activity': [{ id: 'activity-1' }],
    });
    await createProject(
      { name: 'Demo', visibility: 'public', repoIds: ['11111111-1111-4111-8111-111111111111'] },
      { id: 'owner-1', teamId: 'team-1' },
      { db },
    );
    const valuesCall = db._callsFor('project_activity').find((c) => c.method === 'values');
    expect(valuesCall?.args[0]).toMatchObject({
      label: 'Created project',
      actorName: 'Owner',
      actorTint: '#f60',
      eventKey: 'create_project:proj-1',
    });
  });
});

describe('archive list reads', () => {
  it('visibleProjects excludes archived rows and archivedProjects returns only archived rows newest-first', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const activeDetails = buildInitialDetails();
    const archivedOlderDetails = buildInitialDetails();
    const archivedNewerDetails = buildInitialDetails();

    const mockDb = createMockDb({
      'select:project': seq(
        [
          {
            id: 'active-1',
            name: 'Active',
            summary: null,
            visibility: 'public',
            phase: 'design',
            currentStage: 'exploration',
            ownerId: 'owner-1',
            updatedAt: new Date('2026-07-14T08:00:00.000Z'),
            archived: false,
            details: activeDetails,
          },
        ],
        [
          {
            id: 'archived-2',
            name: 'Archived newer',
            summary: null,
            visibility: 'public',
            phase: 'completed',
            currentStage: 'journal',
            ownerId: 'owner-1',
            updatedAt: new Date('2026-07-14T07:00:00.000Z'),
            archived: true,
            details: archivedNewerDetails,
          },
          {
            id: 'archived-1',
            name: 'Archived older',
            summary: null,
            visibility: 'public',
            phase: 'build',
            currentStage: 'execute',
            ownerId: 'owner-1',
            updatedAt: new Date('2026-07-14T06:00:00.000Z'),
            archived: true,
            details: archivedOlderDetails,
          },
        ],
      ),
      'select:team_member': [{ id: 'owner-1', displayName: 'Owner', avatarTint: '#fff' }],
    });

    const { archivedProjects } = await import('@/projects/projects-core');
    const active = await visibleProjects({ id: 'owner-1', teamId: 'team-1' }, { db: mockDb });
    const archived = await archivedProjects({ id: 'owner-1', teamId: 'team-1' }, { db: mockDb });

    expect(active.map((p) => p.id)).toEqual(['active-1']);
    expect(active.every((p) => p.archived === false)).toBe(true);
    // Ordered newest-first by updatedAt (no separate archive timestamp).
    expect(archived.map((p) => p.id)).toEqual(['archived-2', 'archived-1']);
    expect(archived.every((p) => p.archived === true)).toBe(true);
  });
});

describe('archive mutations', () => {
  it('archiveProject sets archived=true, updates only archived/updatedAt, and swallows activity failures', async () => {
    const projectId = 'proj-archive';
    const ownerId = 'owner-archive';

    const mockDb = createMockDb({
      'select:project': seq(
        [{ id: projectId, visibility: 'public', ownerId, teamId: 'team-1' }],
        [{ ownerId, archived: false, phase: 'build', currentStage: 'execute', completedAt: new Date('2026-07-01T00:00:00.000Z'), details: { keep: true } }],
      ),
      'update:project': [{ id: projectId, archived: true }],
      'insert:project_activity': new Error('activity insert failed'),
    });

    const { archiveProject } = await import('@/projects/projects-core');
    const result = await archiveProject(projectId, { id: ownerId, teamId: 'team-1' }, { db: mockDb });

    expect(result.archived).toBe(true);
    const setCall = mockDb._callsFor('project').find((call) => call.method === 'set');
    expect(setCall?.args[0]).toEqual(expect.objectContaining({
      archived: true,
      updatedAt: expect.any(Date),
    }));
    expect(setCall?.args[0]).not.toHaveProperty('phase');
    expect(setCall?.args[0]).not.toHaveProperty('currentStage');
    expect(setCall?.args[0]).not.toHaveProperty('completedAt');
    expect(setCall?.args[0]).not.toHaveProperty('details');
  });

  it('archiveProject is idempotent for an already archived row', async () => {
    const mockDb = createMockDb({
      'select:project': seq(
        [{ id: 'proj-a', visibility: 'public', ownerId: 'owner-a', teamId: 'team-1' }],
        [{ ownerId: 'owner-a', archived: true }],
      ),
    });

    const { archiveProject } = await import('@/projects/projects-core');
    const result = await archiveProject('proj-a', { id: 'owner-a', teamId: 'team-1' }, { db: mockDb });

    expect(result.archived).toBe(true);
    expect(mockDb._assertCalled('project', 'update')).toBe(false);
  });

  it('unarchiveProject sets archived=false for the owner and is a no-op for an active row', async () => {
    const archivedDb = createMockDb({
      'select:project': seq(
        [{ id: 'proj-u', visibility: 'public', ownerId: 'owner-u', teamId: 'team-1' }],
        [{ ownerId: 'owner-u', archived: true }],
      ),
      'update:project': [{ id: 'proj-u', archived: false }],
      'insert:project_activity': [],
    });

    const { unarchiveProject } = await import('@/projects/projects-core');
    const result = await unarchiveProject('proj-u', { id: 'owner-u', teamId: 'team-1' }, { db: archivedDb });
    expect(result.archived).toBe(false);
    expect(archivedDb._assertCalled('project', 'update')).toBe(true);

    const activeDb = createMockDb({
      'select:project': seq(
        [{ id: 'proj-u2', visibility: 'public', ownerId: 'owner-u', teamId: 'team-1' }],
        [{ ownerId: 'owner-u', archived: false }],
      ),
    });

    await unarchiveProject('proj-u2', { id: 'owner-u', teamId: 'team-1' }, { db: activeDb });
    expect(activeDb._assertCalled('project', 'update')).toBe(false);
  });

  it('archiveProject rejects a readable non-owner with ProjectAccessError', async () => {
    const mockDb = createMockDb({
      'select:project': seq(
        [{ id: 'proj-forbidden', visibility: 'public', ownerId: 'owner-1', teamId: 'team-1' }],
        [{ ownerId: 'owner-1', archived: false }],
      ),
    });

    const { archiveProject } = await import('@/projects/projects-core');
    await expect(
      archiveProject('proj-forbidden', { id: 'reader-1', teamId: 'team-1' }, { db: mockDb }),
    ).rejects.toThrow(ProjectAccessError);
  });
});

describe('createProject — subset creation', () => {
  it('creates a spec-plan subset and redirects from spec entry state', async () => {
    const { SPEC_TEMPLATE_SEEDS } = await import('@/db/seed/team-spec-template');
    const db = createMockDb({
      'select:workspace_repo': [{ id: repo1, name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' }],
      'select:team_spec_template': SPEC_TEMPLATE_SEEDS.map((seed, i) => ({ id: `tpl-${i}`, kind: seed.kind, label: seed.label })),
      'insert:project': [{ id: 'subset-test-1' }],
    });
    const res = await createProject({
      name: 'subset',
      visibility: 'public',
      repoIds: [repo1],
      selectedDesignStages: ['spec', 'plan'],
      uploadedArtifact: {
        kind: 'exploration',
        filename: 'ignored.md',
        content: `---\nversion: 1\nupdated_at: 2026-07-14\n---\n\n## Background\n\nContext`,
      },
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: true, id: 'subset-test-1', entryStage: 'spec' });
  });

  it('fails when repoIds is empty in subset mode', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset',
      visibility: 'public',
      repoIds: [],
      selectedDesignStages: ['spec'],
      uploadedArtifact: {
        kind: 'exploration',
        filename: 'ignored.md',
        content: `---\nversion: 1\nupdated_at: 2026-07-14\n---\n\n## Background\n\nContext`,
      },
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'repoIds' } });
  });

  it('returns the inline file error and creates no row on parse failure', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset',
      visibility: 'public',
      repoIds: [repo1],
      selectedDesignStages: ['spec'],
      uploadedArtifact: {
        kind: 'exploration',
        filename: 'ignored.md',
        content: `## Missing frontmatter`,
      },
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toEqual({
      ok: false,
      error: { field: 'artifact', message: 'file failed to load or parse — re-upload' },
    });
    expect(db._assertCalled('project', 'insert')).toBe(false);
  });

  it('rejects a spec-start subset with no uploaded exploration and creates no row (FR-3)', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset', visibility: 'public', repoIds: [repo1],
      selectedDesignStages: ['spec'],
      // no uploadedArtifact
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'artifact' } });
    expect(db._assertCalled('project', 'insert')).toBe(false);
  });

  it('rejects a plan-start subset with no uploaded spec and creates no row (FR-4)', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset', visibility: 'public', repoIds: [repo1],
      selectedDesignStages: ['plan'],
      // no uploadedArtifact
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'artifact' } });
    expect(db._assertCalled('project', 'insert')).toBe(false);
  });

  it('rejects a spec-start subset whose upload is a spec (wrong upstream kind) (FR-3)', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset', visibility: 'public', repoIds: [repo1],
      selectedDesignStages: ['spec'],
      uploadedArtifact: { kind: 'spec', filename: 'x.md', content: '## Context\n\ntext' },
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'artifact' } });
    expect(db._assertCalled('project', 'insert')).toBe(false);
  });
});
