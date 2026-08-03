// @vitest-environment node
/**
 * `syncWorkspaceRepos` reconciles the workspace directory with the `repo` table on every
 * workspace page load. It marks a row `error` when its directory is gone — and it used to
 * do that to rows that had never claimed a directory yet.
 */
import { vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockDb } from '../test-utils/mock-db';

const root = mkdtempSync(join(tmpdir(), 'forge-sync-'));
vi.mock('@/git/workspace-root', () => ({
  resolveTeamWorkspaceRoot: () => root,
  resolveWorkspaceRoot: () => root,
}));

const { syncWorkspaceRepos } = await import('@/git/repos-core');

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A repo row as the sync reads it. */
const row = (over: Record<string, unknown>) => ({
  id: 'r1', name: 'widgets', pathOnDisk: join(root, 'widgets'), status: 'cloned', ...over,
});

function dbWith(rows: Array<Record<string, unknown>>) {
  return createMockDb({ 'select:workspace_repo': rows, 'select:team_team': [{ id: 't1', workspaceRootPath: root }] });
}

describe('syncWorkspaceRepos — which rows may be flagged', () => {
  /**
   * A clone in flight sits at `pulling` with a PLACEHOLDER `pathOnDisk` — the bare repo
   * name, not a path, because the real one is only known once the clone lands. The loop
   * skipped `error` rows only, so `existsSync('widgets')` resolved against the process cwd,
   * found nothing, and a workspace page loaded during a clone marked that clone failed.
   */
  it('does not flag a repo whose clone is still running', async () => {
    const db = dbWith([row({ status: 'pulling', pathOnDisk: 'widgets' })]);
    const res = await syncWorkspaceRepos({ db: db as never, teamId: 't1' });

    expect(res.flagged).toEqual([]);
    expect(db._wasCalled('workspace_repo', 'update')).toBe(false);
  });

  it('does flag a repo that claims to be cloned and is not on disk', async () => {
    const db = dbWith([row({ pathOnDisk: join(root, 'gone') })]);
    const res = await syncWorkspaceRepos({ db: db as never, teamId: 't1' });

    expect(res.flagged).toEqual(['widgets']);
  });

  it('leaves a cloned repo that IS on disk alone', async () => {
    mkdirSync(join(root, 'present'), { recursive: true });
    const db = dbWith([row({ name: 'present', pathOnDisk: join(root, 'present') })]);
    const res = await syncWorkspaceRepos({ db: db as never, teamId: 't1' });

    expect(res.flagged).toEqual([]);
  });

  it('does not re-flag a row already in error', async () => {
    const db = dbWith([row({ status: 'error', pathOnDisk: join(root, 'gone') })]);
    expect((await syncWorkspaceRepos({ db: db as never, teamId: 't1' })).flagged).toEqual([]);
  });

  /**
   * The requirement used to be a throw inside the per-directory insert, so an unscoped sync
   * half-worked: it flagged rows and returned normally right up until it met an unregistered
   * directory. The workspace page carries a comment warning about exactly that.
   */
  it('refuses a team-less call outright rather than half-working', async () => {
    await expect(syncWorkspaceRepos({ db: dbWith([]) as never })).rejects.toThrow(/Team required/);
  });
});
