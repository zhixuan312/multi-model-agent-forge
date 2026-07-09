// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  planProjectArtifactMigration,
  migrateProjectArtifacts,
} from '@/projects/migrate-artifacts-to-team-root';
import { createMockDb } from '../test-utils/mock-db';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'mma-migrate-'));
  tmps.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe('planProjectArtifactMigration (pure)', () => {
  it('is a noop when the global root and team root are identical', () => {
    const plan = planProjectArtifactMigration({
      projectId: 'p1',
      globalRoot: '/root',
      teamRoot: '/root',
    });
    expect(plan.action).toBe('noop');
    expect(plan.from).toBe(plan.to);
    expect(plan.to).toBe(join('/root', '.mma', 'projects', 'p1'));
  });

  it('plans a move from the global root to a distinct team root', () => {
    const plan = planProjectArtifactMigration({
      projectId: 'p2',
      globalRoot: '/global',
      teamRoot: '/teams/acme',
    });
    expect(plan.action).toBe('move');
    expect(plan.from).toBe(join('/global', '.mma', 'projects', 'p2'));
    expect(plan.to).toBe(join('/teams/acme', '.mma', 'projects', 'p2'));
  });
});

describe('migrateProjectArtifacts (filesystem)', () => {
  it('moves an existing project dir from the global root to its team root', async () => {
    const globalRoot = tmp();
    const teamRoot = tmp();
    const pid = 'proj-move';
    const from = join(globalRoot, '.mma', 'projects', pid);
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, 'spec.md'), 'hello');

    const db = createMockDb({
      'select:project': [{ id: pid, workspaceRootPath: teamRoot }],
    });

    const report = await migrateProjectArtifacts({ db, globalRoot });

    expect(report).toEqual([
      expect.objectContaining({ projectId: pid, result: 'moved' }),
    ]);
    expect(existsSync(from)).toBe(false);
    const to = join(teamRoot, '.mma', 'projects', pid, 'spec.md');
    expect(readFileSync(to, 'utf8')).toBe('hello');
  });

  it('is a noop when the team root equals the global root', async () => {
    const root = tmp();
    const pid = 'proj-same';
    const dir = join(root, '.mma', 'projects', pid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plan.md'), 'stay');

    const db = createMockDb({
      'select:project': [{ id: pid, workspaceRootPath: root }],
    });

    const report = await migrateProjectArtifacts({ db, globalRoot: root });

    expect(report).toEqual([
      expect.objectContaining({ projectId: pid, result: 'noop' }),
    ]);
    expect(readFileSync(join(dir, 'plan.md'), 'utf8')).toBe('stay');
  });

  it('skips a project whose source dir does not exist (idempotent re-run)', async () => {
    const globalRoot = tmp();
    const teamRoot = tmp();
    const pid = 'proj-gone';

    const db = createMockDb({
      'select:project': [{ id: pid, workspaceRootPath: teamRoot }],
    });

    const report = await migrateProjectArtifacts({ db, globalRoot });

    expect(report).toEqual([
      expect.objectContaining({ projectId: pid, result: 'skipped-no-source' }),
    ]);
  });

  it('merges into an existing destination, reporting per-file conflicts without clobbering', async () => {
    const globalRoot = tmp();
    const teamRoot = tmp();
    const pid = 'proj-merge';
    const from = join(globalRoot, '.mma', 'projects', pid);
    const to = join(teamRoot, '.mma', 'projects', pid);
    mkdirSync(from, { recursive: true });
    mkdirSync(to, { recursive: true });
    writeFileSync(join(from, 'spec.md'), 'source-spec');   // conflicts with dest
    writeFileSync(join(from, 'plan.md'), 'source-plan');   // new to dest
    writeFileSync(join(to, 'spec.md'), 'dest-spec');       // pre-existing

    const db = createMockDb({
      'select:project': [{ id: pid, workspaceRootPath: teamRoot }],
    });

    const report = await migrateProjectArtifacts({ db, globalRoot });

    expect(report[0]).toMatchObject({ projectId: pid, result: 'merged', conflicts: ['spec.md'] });
    // Pre-existing dest file preserved, new file moved in.
    expect(readFileSync(join(to, 'spec.md'), 'utf8')).toBe('dest-spec');
    expect(readFileSync(join(to, 'plan.md'), 'utf8')).toBe('source-plan');
    // The conflicting source file remains at the source; the moved one is gone.
    expect(existsSync(join(from, 'spec.md'))).toBe(true);
    expect(existsSync(join(from, 'plan.md'))).toBe(false);
  });

  it('dryRun computes the plan without touching the filesystem', async () => {
    const globalRoot = tmp();
    const teamRoot = tmp();
    const pid = 'proj-dry';
    const from = join(globalRoot, '.mma', 'projects', pid);
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, 'spec.md'), 'x');

    const db = createMockDb({
      'select:project': [{ id: pid, workspaceRootPath: teamRoot }],
    });

    const report = await migrateProjectArtifacts({ db, globalRoot, dryRun: true });

    expect(report[0]).toMatchObject({ projectId: pid, result: 'moved', dryRun: true });
    // Source untouched.
    expect(existsSync(from)).toBe(true);
    expect(existsSync(join(teamRoot, '.mma', 'projects', pid))).toBe(false);
  });
});
