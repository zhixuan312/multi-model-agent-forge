// @vitest-environment node
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveCloneTarget,
  WorkspaceService,
  PathEscapeError,
  type GitRunner,
  type GitRunResult,
} from '@/git/workspace';

const TOKEN = 'ghp_SECRETtoken123';

/** A GitRunner stub that records argv + records the cwd, returns scripted output. */
function fakeRunner(
  script: (cmd: string[], cwd: string) => GitRunResult,
): { runner: GitRunner; calls: { cmd: string[]; cwd: string }[] } {
  const calls: { cmd: string[]; cwd: string }[] = [];
  const runner: GitRunner = async (cmd, opts) => {
    calls.push({ cmd, cwd: opts.cwd });
    return script(cmd, opts.cwd);
  };
  return { runner, calls };
}

const ok = (stdout = ''): GitRunResult => ({ code: 0, stdout, stderr: '' });

describe('resolveCloneTarget (path sandbox)', () => {
  const root = '/srv/workspace';
  it('accepts a normal name → <root>/<name>', () => {
    expect(resolveCloneTarget(root, 'core-api')).toBe(join(root, 'core-api'));
  });
  it('rejects a name containing a slash', () => {
    expect(() => resolveCloneTarget(root, 'a/b')).toThrow(PathEscapeError);
  });
  it('rejects .. traversal', () => {
    expect(() => resolveCloneTarget(root, '..')).toThrow(PathEscapeError);
    expect(() => resolveCloneTarget(root, '..evil')).not.toThrow(); // leading-dot name is fine
  });
  it('rejects an absolute path', () => {
    expect(() => resolveCloneTarget(root, '/etc/passwd')).toThrow(PathEscapeError);
  });
  it('rejects an empty name', () => {
    expect(() => resolveCloneTarget(root, '')).toThrow(PathEscapeError);
  });
});

describe('WorkspaceService.cloneRepo', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ws-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('clones into <root>/<name>, returns pathOnDisk/defaultBranch/headSha; status transitions reported', async () => {
    const { runner, calls } = fakeRunner((cmd) => {
      if (cmd[0] === 'clone') return ok();
      if (cmd.includes('--abbrev-ref')) return ok('main\n');
      if (cmd.includes('rev-parse') && cmd.includes('HEAD')) return ok('abcdef1234567890\n');
      return ok();
    });
    const statuses: string[] = [];
    const svc = new WorkspaceService({ workspaceRoot: root, gitRunner: runner });
    const result = await svc.cloneRepo({
      url: 'https://github.com/acme/core-api.git',
      name: 'core-api',
      token: TOKEN,
      onStatus: (s) => statuses.push(s),
    });
    expect(result.pathOnDisk).toBe(join(root, 'core-api'));
    expect(result.headSha).toBe('abcdef1234567890');
    expect(result.defaultBranch).toBe('main');
    expect(statuses).toEqual(['pulling', 'cloned']);
    // the clone command targeted the sandboxed dir
    const cloneCall = calls.find((c) => c.cmd[0] === 'clone')!;
    expect(cloneCall.cmd).toContain(join(root, 'core-api'));
  });

  it('NEVER puts the token in argv or in the returned/logged data', async () => {
    const { runner, calls } = fakeRunner((cmd) => {
      if (cmd[0] === 'clone') return ok();
      if (cmd.includes('--abbrev-ref')) return ok('main\n');
      return ok('deadbeef\n');
    });
    const svc = new WorkspaceService({ workspaceRoot: root, gitRunner: runner });
    await svc.cloneRepo({ url: 'https://github.com/a/b.git', name: 'b', token: TOKEN });
    const allArgv = JSON.stringify(calls.map((c) => c.cmd));
    expect(allArgv).not.toContain(TOKEN);
  });

  it('clone auth failure → throws with status reported error, token scrubbed from the message', async () => {
    const { runner } = fakeRunner((cmd) => {
      if (cmd[0] === 'clone') {
        return { code: 128, stdout: '', stderr: `fatal: Authentication failed for 'https://x-access-token:${TOKEN}@github.com/a/b.git/'` };
      }
      return ok();
    });
    const statuses: string[] = [];
    const svc = new WorkspaceService({ workspaceRoot: root, gitRunner: runner });
    const err = await svc
      .cloneRepo({ url: 'https://github.com/a/b.git', name: 'b', token: TOKEN, onStatus: (s) => statuses.push(s) })
      .catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toMatch(/auth/i);
    expect(statuses).toEqual(['pulling', 'error']);
  });

  it('rejects a path-escaping repo name before running git', async () => {
    const { runner, calls } = fakeRunner(() => ok());
    const svc = new WorkspaceService({ workspaceRoot: root, gitRunner: runner });
    const err = await svc.cloneRepo({ url: 'u', name: '../escape', token: TOKEN }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(PathEscapeError);
    expect(calls).toHaveLength(0); // never invoked git
  });

  it('fails fast when the workspace root is missing/unwritable, no stuck pulling', async () => {
    const { runner } = fakeRunner(() => ok());
    const statuses: string[] = [];
    const svc = new WorkspaceService({ workspaceRoot: join(root, 'does', 'not', 'exist', 'deep'), gitRunner: runner, createRoot: false });
    const err = await svc
      .cloneRepo({ url: 'u', name: 'x', token: TOKEN, onStatus: (s) => statuses.push(s) })
      .catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/workspace/i);
  });
});

describe('WorkspaceService.pullRepo', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(root, 'core-api'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('pulls in the repo dir, advances headSha, status pulling→cloned', async () => {
    const { runner, calls } = fakeRunner((cmd) => {
      if (cmd[0] === 'pull') return ok();
      if (cmd.includes('rev-parse') && cmd.includes('HEAD')) return ok('newsha999\n');
      return ok();
    });
    const statuses: string[] = [];
    const svc = new WorkspaceService({ workspaceRoot: root, gitRunner: runner });
    const result = await svc.pullRepo({
      name: 'core-api',
      pathOnDisk: join(root, 'core-api'),
      token: TOKEN,
      onStatus: (s) => statuses.push(s),
    });
    expect(result.headSha).toBe('newsha999');
    expect(statuses).toEqual(['pulling', 'cloned']);
    const pullCall = calls.find((c) => c.cmd[0] === 'pull')!;
    expect(pullCall.cwd).toBe(join(root, 'core-api'));
  });
});
