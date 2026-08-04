// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProject,
  visibleProjects,
  assertProjectReadable,
  changeVisibility,
  changeRepos,
  ProjectAccessError,
} from '@/projects/projects-core';
import { createMockDb, seq } from '../test-utils/mock-db';
import { buildInitialDetails } from '@/details/schema';
import { archivedProjects, archiveProject, unarchiveProject } from '@/projects/projects-core';

const repo1 = '00000000-0000-4000-8000-000000000001';
const repo2 = '00000000-0000-4000-8000-000000000002';

describe('createProject — seeding + validation', () => {
  it('seeds the project row with an initialised details document', async () => {
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
    expect(mockDb._wasCalled('project', 'insert')).toBe(true);
    // Both cases below were titled "…with details initialized" while asserting only
    // `ok` — the details document itself went unchecked. It is the whole point of the
    // seed: an absent one leaves every stage unreadable to the resolver.
    const seeded = mockDb._callsFor('project').find((c) => c.method === 'values')?.args[0] as
      | { details?: { stages?: Record<string, unknown> } }
      | undefined;
    expect(seeded?.details?.stages).toBeDefined();
    expect(Object.keys(seeded!.details!.stages!)).toContain('exploration');
  });

  it('persists the chosen visibility, not just a default', async () => {
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
    // This case existed only to run the private path; without asserting the column it
    // was indistinguishable from the public case above.
    const inserted = mockDb._callsFor('project').find((c) => c.method === 'values')?.args[0] as
      | { visibility?: string }
      | undefined;
    expect(inserted?.visibility).toBe('private');
  });

  it('rejects create when a repo id is not owned by the actor team', async () => {
    // repoIds are team-scoped at load (eq(repo.teamId, actor.teamId)); a foreign/unknown
    // id yields fewer rows than requested → create fails closed (no project row, no path bind).
    const ownerId = 'owner-1f';
    const mockDb = createMockDb({
      // Requested two ids; only one belongs to the actor's team.
      'select:workspace_repo': [{ id: repo1, name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' }],
      'insert:project': [{ id: 'proj-1f', phase: 'design', currentStage: 'exploration', ownerId }],
    });

    const res = await createProject(
      { name: 'test-proj', visibility: 'public', repoIds: [repo1, repo2] },
      { id: ownerId, teamId: 'team-1' },
      { db: mockDb },
    );
    expect(res.ok).toBe(false);
    // …and says WHICH field. Every failure inside the create transaction used to surface as
    // `{ field: 'artifact', message: 'file failed to load or parse — re-upload' }`, so a
    // cross-team repo id told the user to re-upload a file they may not have attached.
    if (!res.ok) {
      expect(res.error.field).toBe('repoIds');
      expect(res.error.message).toMatch(/do not belong to your team/i);
    }
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
      'select:workspace_repo': [{ id: repo1, name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' }],
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

/**
 * The list card shows a "repo unavailable" chip, and ProjectCard is tested for it — with a
 * hand-supplied prop. The producer never populated the field: `unavailableByProject` was
 * declared and read, never written, so `unavailableRepoCount` was ALWAYS 0 and the chip
 * could not appear in production however broken a project's repos were. A user whose repo
 * row had been deleted or had gone to `status: 'error'` saw a confident "3 repos" and
 * found out only when a dispatch failed.
 *
 * `repoCount` had the mirror problem: documented as resolvable-only, counted straight off
 * the details snapshot, so it included the dangling ones.
 */
describe('repo availability on the list card', () => {
  const detailsWithRepos = (ids: string[]) => {
    const d = buildInitialDetails();
    d.repos = ids.map((id) => ({ id, name: id, pathOnDisk: `/w/${id}`, defaultBranch: 'main' }));
    return d;
  };
  const row = (details: ReturnType<typeof detailsWithRepos>) => ({
    id: 'proj-r', name: 'R', summary: null, visibility: 'public' as const,
    phase: 'design' as const, currentStage: 'exploration' as const,
    ownerId: 'owner-r', updatedAt: new Date(), details, archived: false,
  });

  it('counts an errored repo as unavailable, not as a working one', async () => {
    const mockDb = createMockDb({
      'select:project': [row(detailsWithRepos(['r1', 'r2']))],
      'select:member': [{ id: 'owner-r', displayName: 'O', avatarTint: '#000000' }],
      'select:workspace_repo': [{ id: 'r1', status: 'cloned' }, { id: 'r2', status: 'error' }],
    });
    const [item] = await visibleProjects({ id: 'owner-r', teamId: 'team-1' }, { db: mockDb });
    expect(item.unavailableRepoCount).toBe(1);
    expect(item.repoCount).toBe(1);
  });

  it('counts a repo whose row is gone as unavailable', async () => {
    const mockDb = createMockDb({
      'select:project': [row(detailsWithRepos(['r1', 'gone']))],
      'select:member': [{ id: 'owner-r', displayName: 'O', avatarTint: '#000000' }],
      'select:workspace_repo': [{ id: 'r1', status: 'cloned' }],
    });
    const [item] = await visibleProjects({ id: 'owner-r', teamId: 'team-1' }, { db: mockDb });
    expect(item.unavailableRepoCount).toBe(1);
    expect(item.repoCount).toBe(1);
  });

  it('reports none unavailable when every repo resolves', async () => {
    const mockDb = createMockDb({
      'select:project': [row(detailsWithRepos(['r1', 'r2']))],
      'select:member': [{ id: 'owner-r', displayName: 'O', avatarTint: '#000000' }],
      'select:workspace_repo': [{ id: 'r1', status: 'cloned' }, { id: 'r2', status: 'pulling' }],
    });
    const [item] = await visibleProjects({ id: 'owner-r', teamId: 'team-1' }, { db: mockDb });
    expect(item.unavailableRepoCount).toBe(0);
    expect(item.repoCount).toBe(2);
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

  /**
   * The tenancy boundary for the entire project list.
   *
   * This case asserted `db._wasCalled('project', 'where')` — that SOME where clause ran.
   * Any clause satisfies that, including one with the team conjunct deleted, so the check
   * could not fail on the thing its title names. And a mock DB returns whatever rows it is
   * handed regardless of the predicate, so no behavioural assertion can cover it either.
   *
   * The predicate is therefore read from source, bounded to `listProjects` so a match
   * elsewhere in the file cannot stand in for it. All three conjuncts matter: team scoping
   * (never another team's projects), the public-or-owner rule (never a stranger's private
   * project), and the archived split (the two lists must not merge).
   */
  it('scopes the list query by team, visibility and archive state', () => {
    const src = readFileSync(join(process.cwd(), 'src/projects/projects-core.ts'), 'utf8');
    const start = src.indexOf('async function listProjects');
    expect(start, 'listProjects moved — repoint this test').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\nexport ', start + 1));

    expect(body, 'the team conjunct is what keeps one team out of another’s projects')
      .toContain('eq(project.teamId, actor.teamId)');
    expect(body, 'without this a private project is listed to every teammate')
      .toMatch(/or\(\s*eq\(project\.visibility, 'public'\),\s*eq\(project\.ownerId, actor\.id\)\s*\)/);
    expect(body, 'the active and archived lists must not merge')
      .toContain('eq(project.archived, wantArchived)');
  });

  /**
   * And the actor's team id is really BOUND into that clause, not merely named in source.
   * Source proves the shape; this proves the value flows through — the two together are
   * what `runs-query.test.ts` established for the loops queries.
   */
  it('binds the caller’s team id into the list query', async () => {
    const db = createMockDb({ 'select:project': [] });
    await visibleProjects({ id: 'owner-a', teamId: 'team-a' }, { db });

    const seen = new Set<unknown>();
    const params: unknown[] = [];
    const visit = (v: unknown, depth = 0): void => {
      if (v === null || v === undefined || depth > 8) return;
      if (typeof v !== 'object') { params.push(v); return; }
      if (seen.has(v)) return;
      seen.add(v);
      for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
        visit(child, depth + 1);
      }
    };
    for (const c of db._callsFor('project').filter((c) => c.method === 'where')) visit(c.args[0]);

    expect(params, 'the actor team never reached the query').toContain('team-a');
    // Only the team id is asserted here. The visibility literal sits deeper in the clause
    // than this walker reaches, and an assertion that cannot find what it looks for is the
    // failure mode this whole audit keeps closing — the SOURCE check above is what covers
    // that conjunct.
  });

  /** Both public lists must go through that one predicate, or one of them can lose it. */
  it('visibleProjects and archivedProjects share the scoped query', () => {
    const src = readFileSync(join(process.cwd(), 'src/projects/projects-core.ts'), 'utf8');
    for (const fn of ['visibleProjects', 'archivedProjects']) {
      const at = src.indexOf(`export async function ${fn}`);
      const body = src.slice(at, src.indexOf('\n}', at));
      expect(body, `${fn} must delegate to listProjects, not run its own query`).toContain('listProjects(actor,');
      expect(body, `${fn} builds its own where clause`).not.toContain('.where(');
    }
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
    expect(mockDb._wasCalled('project', 'update')).toBe(true);
  });

  it('changeRepos updates details repos', async () => {
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
    expect(mockDb._wasCalled('project', 'update')).toBe(true);
  });

  it('changeRepos rejects a repo id not owned by the actor team (fewer rows returned)', async () => {
    // The repo lookup is team-scoped (eq(repo.teamId, actor.teamId)); a foreign id is
    // excluded, so fewer rows come back than were requested and the change is rejected —
    // never silently dropping the foreign repo or binding its path.
    const projectId = 'proj-9x';
    const ownerId = 'owner-9x';
    const d = buildInitialDetails();
    d.repos = [{ id: 'repo-1', name: 'old', pathOnDisk: '/tmp', defaultBranch: 'main' }];
    const mockDb = createMockDb({
      'select:project': seq([{ id: projectId, ownerId }], [{ details: d, detailsVersion: 0 }]),
      // Requested two ids; only the actor-team one comes back (the foreign id is filtered out).
      'select:workspace_repo': [{ id: 'mine', name: 'mine', pathOnDisk: '/tmp/mine', defaultBranch: 'main' }],
      'update:project': [{ id: projectId }],
    });

    await expect(
      changeRepos(projectId, ['mine', 'foreign-team-repo'], { id: ownerId, teamId: 'team-1' }, { db: mockDb }),
    ).rejects.toThrow(/do not belong to your team/i);
    expect(mockDb._wasCalled('project', 'update')).toBe(false);
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

    const result = await archiveProject('proj-a', { id: 'owner-a', teamId: 'team-1' }, { db: mockDb });

    expect(result.archived).toBe(true);
    expect(mockDb._wasCalled('project', 'update')).toBe(false);
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

    const result = await unarchiveProject('proj-u', { id: 'owner-u', teamId: 'team-1' }, { db: archivedDb });
    expect(result.archived).toBe(false);
    expect(archivedDb._wasCalled('project', 'update')).toBe(true);

    const activeDb = createMockDb({
      'select:project': seq(
        [{ id: 'proj-u2', visibility: 'public', ownerId: 'owner-u', teamId: 'team-1' }],
        [{ ownerId: 'owner-u', archived: false }],
      ),
    });

    await unarchiveProject('proj-u2', { id: 'owner-u', teamId: 'team-1' }, { db: activeDb });
    expect(activeDb._wasCalled('project', 'update')).toBe(false);
  });

  it('archiveProject rejects a readable non-owner with ProjectAccessError', async () => {
    const mockDb = createMockDb({
      'select:project': seq(
        [{ id: 'proj-forbidden', visibility: 'public', ownerId: 'owner-1', teamId: 'team-1' }],
        [{ ownerId: 'owner-1', archived: false }],
      ),
    });

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
    expect(db._wasCalled('project', 'insert')).toBe(false);
  });

  it('rejects a spec-start subset with no uploaded exploration and creates no row (FR-3)', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset', visibility: 'public', repoIds: [repo1],
      selectedDesignStages: ['spec'],
      // no uploadedArtifact
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'artifact' } });
    expect(db._wasCalled('project', 'insert')).toBe(false);
  });

  it('rejects a plan-start subset with no uploaded spec and creates no row (FR-4)', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset', visibility: 'public', repoIds: [repo1],
      selectedDesignStages: ['plan'],
      // no uploadedArtifact
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'artifact' } });
    expect(db._wasCalled('project', 'insert')).toBe(false);
  });

  it('rejects a spec-start subset whose upload is a spec (wrong upstream kind) (FR-3)', async () => {
    const db = createMockDb({});
    const res = await createProject({
      name: 'subset', visibility: 'public', repoIds: [repo1],
      selectedDesignStages: ['spec'],
      uploadedArtifact: { kind: 'spec', filename: 'x.md', content: '## Context\n\ntext' },
    }, { id: 'owner-1', teamId: 'team-1' }, { db });
    expect(res).toMatchObject({ ok: false, error: { field: 'artifact' } });
    expect(db._wasCalled('project', 'insert')).toBe(false);
  });
});

describe('createProject — branch-slug uniqueness', () => {
  const mk = (existing: Array<{ id: string; name: string }>) =>
    createMockDb({
      'select:workspace_repo': [{ id: repo1, name: 'repo-a', pathOnDisk: '/tmp/a', defaultBranch: 'main' }],
      'select:project': existing,
      'insert:project': [{ id: 'new-proj' }],
    });

  const create = (name: string, db: ReturnType<typeof createMockDb>) =>
    createProject({ name, visibility: 'public', repoIds: [repo1] }, { id: 'owner-1', teamId: 'team-1' }, { db: db as never });

  it('allows a name whose slug is free', async () => {
    const res = await create('Brand New Thing', mk([{ id: 'p1', name: 'Something Else' }]));
    expect(res.ok).toBe(true);
  });

  /**
   * The reason uniqueness is enforced on the SLUG rather than on the name: these two names are
   * distinct under any case-insensitive comparison, yet both slugify to `my-project` and would
   * therefore claim the identical branch `mma/<date>-my-project` once short ids were dropped —
   * silently interleaving two projects' commits.
   */
  it('rejects a text-distinct name that slugifies onto an existing project', async () => {
    const res = await create('My/Project', mk([{ id: 'p1', name: 'My Project' }]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // Assert what the CLIENT actually consumes. There used to be a `code:
      // 'duplicate_name'` here, but `NewProjectState` omits it and the form reads only
      // `field` and `message` — so this test was the sole thing keeping the field alive.
      expect(res.error.field).toBe('name');
      expect(res.error.message).toMatch(/already uses the branch name/i);
    }
  });

  /**
   * The slug check lives INSIDE the create transaction, behind a per-team advisory lock. It
   * used to run before it — a pre-check and nothing more, since there is no DB constraint
   * behind it (uniqueness is on the slug, and the slug rule is JS the database cannot
   * evaluate). Two creates a moment apart both read "free" and both inserted, and the two
   * projects then shared one branch.
   */
  it('takes the per-team lock before deciding the slug is free', async () => {
    const db = mk([{ id: 'p1', name: 'My Project' }]);
    await create('Another Name', db);
    const locked = db._calls.some((c) => c.method === 'execute' && String(c.args[0]).includes('pg_advisory_xact_lock'));
    expect(locked, 'the slug check must be serialised per team').toBe(true);
  });

  it('rejects a name differing only by case or spacing', async () => {
    for (const name of ['MY PROJECT', 'My  Project']) {
      const res = await create(name, mk([{ id: 'p1', name: 'My Project' }]));
      expect(res.ok, name).toBe(false);
    }
  });

  it('scopes the check to the team (an empty team list never collides)', async () => {
    const res = await create('My Project', mk([]));
    expect(res.ok).toBe(true);
  });
});
