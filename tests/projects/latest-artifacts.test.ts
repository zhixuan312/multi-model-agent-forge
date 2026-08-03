// @vitest-environment node
/**
 * `readLatestArtifacts` — the dashboard's "furthest-along artifact per project" read.
 *
 * It exists because the dashboard did this inline, as up to three sequential `read*File`
 * calls per project, and EACH of those resolves the artifact directory by joining `project`
 * to `team` in its own query. Thirty projects cost up to ninety queries and ninety file
 * reads, in series, under a module docstring promising "one query per signal over the scoped
 * id set … never N+1".
 *
 * So the query count is the thing under test here, not an afterthought: without it this is
 * just a refactor that could regress back the moment someone finds it convenient.
 */
import { vi } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';

const fsMock = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('fs/promises', () => ({ ...fsMock, mkdir: vi.fn(), writeFile: vi.fn() }));

const { readLatestArtifacts } = await import('@/projects/project-files');

/**
 * A file tree keyed by full path; anything else rejects, as a missing file does.
 *
 * The reset lives HERE rather than in a `beforeEach`. Clearing this mock from a hook makes
 * every rejection it later produces surface as an unhandled error and fail the test, even
 * though the code under test awaits it inside a `.catch` — reset it from the test body and
 * the same rejection is handled normally. Call history is still per-test either way.
 */
function withFiles(files: Record<string, string>) {
  fsMock.readFile.mockReset();
  fsMock.readFile.mockImplementation((p: string) =>
    p in files ? Promise.resolve(files[p]!) : Promise.reject(new Error('ENOENT')),
  );
}

const md = (version: number) => `---\nversion: ${version}\nupdated_at: x\n---\n\nbody`;

const dbFor = (ids: string[]) =>
  createMockDb({
    'select:project': ids.map((id) => ({ id, workspaceRootPath: '/root/team-a' })),
  });

const dir = (id: string) => `/root/team-a/.mma/projects/${id}`;

describe('readLatestArtifacts', () => {
  it('prefers plan over spec over exploration, and carries THAT artifact’s version', async () => {
    withFiles({
      [`${dir('p1')}/plan.md`]: md(3),
      [`${dir('p1')}/spec.md`]: md(14),
      [`${dir('p2')}/spec.md`]: md(14),
      [`${dir('p3')}/exploration.md`]: md(2),
    });
    const got = await readLatestArtifacts(['p1', 'p2', 'p3'], dbFor(['p1', 'p2', 'p3']) as never);

    expect(got.get('p1')).toEqual({ kind: 'plan', version: 3 });
    expect(got.get('p2')).toEqual({ kind: 'spec', version: 14 });
    expect(got.get('p3')).toEqual({ kind: 'exploration', version: 2 });
  });

  it('omits a project with no artifacts at all', async () => {
    withFiles({});
    const got = await readLatestArtifacts(['p1'], dbFor(['p1']) as never);
    expect(got.has('p1')).toBe(false);
  });

  it('stops at the first artifact it finds — the spec is never read behind a plan', async () => {
    withFiles({ [`${dir('p1')}/plan.md`]: md(3), [`${dir('p1')}/spec.md`]: md(14) });
    await readLatestArtifacts(['p1'], dbFor(['p1']) as never);

    const read = fsMock.readFile.mock.calls.map((c) => c[0] as string);
    expect(read).toEqual([`${dir('p1')}/plan.md`]);
  });

  /** The whole reason this function exists. */
  it('resolves EVERY project’s directory in one query, not one query each', async () => {
    withFiles({});
    const db = dbFor(['p1', 'p2', 'p3', 'p4', 'p5']);
    await readLatestArtifacts(['p1', 'p2', 'p3', 'p4', 'p5'], db as never);

    const selects = db._callsFor('project').filter((c) => c.method === 'select');
    expect(selects).toHaveLength(1);
  });

  it('degrades to the global root when the DB is unavailable, rather than throwing', async () => {
    withFiles({});
    const exploding = {
      select: () => {
        throw new Error('db down');
      },
    };
    await expect(readLatestArtifacts(['p1'], exploding as never)).resolves.toBeInstanceOf(Map);
    // It still LOOKED for the files — under the global root, not the team one.
    expect(fsMock.readFile).toHaveBeenCalled();
    expect(fsMock.readFile.mock.calls[0]![0]).not.toContain('team-a');
  });

  it('takes no ids as no work', async () => {
    withFiles({});
    const db = dbFor([]);
    expect((await readLatestArtifacts([], db as never)).size).toBe(0);
    expect(db._calls).toHaveLength(0);
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });

  /** `resolveProjectArtifactDir` guards the id format; the batch form must not be laxer. */
  it('drops an id that is not a plain slug', async () => {
    withFiles({});
    const got = await readLatestArtifacts(['../etc', 'p1'], dbFor(['p1']) as never);
    expect(got.has('../etc')).toBe(false);
    const read = fsMock.readFile.mock.calls.map((c) => c[0] as string);
    expect(read.every((p) => !p.includes('..'))).toBe(true);
  });
});
