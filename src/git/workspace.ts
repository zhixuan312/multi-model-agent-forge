/**
 * Git workspace service (Spec 2 §`lib/git/service.ts`).
 *
 * Clones/pulls team repos into the workspace root (`FORGE_WORKSPACE_ROOT`,
 * default `<repo>/.forge-workspace`). Uses `node:child_process` git via an
 * INJECTED `GitRunner` (tests pass a stub — no real git, no real remote).
 *
 * ── Token handling (high-value secret — never exposed) ───────────────────────
 * The git token is injected via a `GIT_ASKPASS` helper passed in the child's
 * ENV, never on the command line (`technical.md` §9) — so the token never appears
 * in argv, in process listings, in the repo's remote config, or in logs. Any
 * error text is scrubbed of the token before it surfaces.
 *
 * ── Path sandbox ─────────────────────────────────────────────────────────────
 * All clone targets are confined to the workspace root: a repo name with a
 * slash, `..`, an absolute path, or one resolving outside the root is rejected
 * (mirrors MMA's `cwd-only` posture).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';

export class PathEscapeError extends Error {
  constructor(name: string) {
    super(`Repo name "${name}" escapes the workspace root and was rejected.`);
    this.name = 'PathEscapeError';
  }
}

export class WorkspaceRootError extends Error {
  constructor(root: string) {
    super(`The workspace directory "${root}" is missing or not writable.`);
    this.name = 'WorkspaceRootError';
  }
}

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The injected git invoker. `env` carries the askpass; `cwd` is the run dir. */
export type GitRunner = (
  argv: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
) => Promise<GitRunResult>;

export const DEFAULT_GIT_OP_TIMEOUT_MS = 120_000;

/**
 * Resolve + sandbox a clone target. Rejects empty names, slashes, `..`, absolute
 * paths, and anything that resolves outside `<root>`. Returns the absolute dir.
 */
export function resolveCloneTarget(root: string, name: string): string {
  if (!name || name.trim() === '') throw new PathEscapeError(name);
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) throw new PathEscapeError(name);
  if (name === '.' || name === '..') throw new PathEscapeError(name);
  const target = resolve(root, name);
  const rootResolved = resolve(root);
  // Must be a direct child of root (target startsWith root + sep, and one level).
  if (target === rootResolved || !target.startsWith(rootResolved + sep)) throw new PathEscapeError(name);
  return target;
}

/** Strip any embedded credential from text so a token can never leak in errors. */
function scrub(text: string, token: string | undefined): string {
  let out = text;
  if (token) out = out.split(token).join('***');
  // Also scrub a `https://x-access-token:...@` pattern defensively.
  out = out.replace(/(https?:\/\/)[^@\s/]+:[^@\s/]+@/g, '$1***@');
  return out;
}

export interface CloneArgs {
  url: string;
  name: string;
  token?: string;
  onStatus?: (status: 'pulling' | 'cloned' | 'error') => void;
}
export interface PullArgs {
  name: string;
  pathOnDisk: string;
  token?: string;
  onStatus?: (status: 'pulling' | 'cloned' | 'error') => void;
}

export interface CloneResult {
  pathOnDisk: string;
  defaultBranch: string;
  headSha: string;
}
export interface PullResult {
  headSha: string;
}

export interface WorkspaceServiceOpts {
  workspaceRoot: string;
  gitRunner?: GitRunner;
  /** Create the root if absent (default true). Tests set false to assert the error. */
  createRoot?: boolean;
  timeoutMs?: number;
}

/** Default GitRunner — spawns `git` via node:child_process. */
const defaultGitRunner: GitRunner = (argv, opts) =>
  new Promise<GitRunResult>((resolvePromise) => {
    const child = spawn('git', argv, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv });
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, opts.timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(killTimer);
      resolvePromise({ code: 127, stdout, stderr: stderr || String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

export class WorkspaceService {
  private readonly root: string;
  private readonly run: GitRunner;
  private readonly createRoot: boolean;
  private readonly timeoutMs: number;

  constructor(opts: WorkspaceServiceOpts) {
    this.root = opts.workspaceRoot;
    this.run = opts.gitRunner ?? defaultGitRunner;
    this.createRoot = opts.createRoot ?? true;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_GIT_OP_TIMEOUT_MS;
  }

  /** Ensure the workspace root exists + is writable, or throw a defined error. */
  private ensureRoot(): void {
    try {
      if (this.createRoot) mkdirSync(this.root, { recursive: true });
      accessSync(this.root, constants.W_OK);
    } catch {
      throw new WorkspaceRootError(this.root);
    }
  }

  /**
   * Build a transient GIT_ASKPASS helper that prints the token. The token lives
   * only in this temp script (mode 0700, deleted in a finally) and in the child
   * env — never in argv. Returns the env + a cleanup fn.
   */
  private askpassEnv(token: string | undefined): { env: Record<string, string>; cleanup: () => void } {
    const baseEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      // Never prompt interactively; fail fast on a missing/invalid credential.
      GIT_TERMINAL_PROMPT: '0',
    };
    if (!token) return { env: baseEnv, cleanup: () => {} };

    const dir = mkdtempSync(join(tmpdir(), 'forge-askpass-'));
    const script = join(dir, 'askpass.sh');
    // For an `https://x-access-token@host` URL git asks for the password (the
    // token). We echo it unconditionally; username defaults to x-access-token.
    writeFileSync(script, `#!/bin/sh\nprintf '%s' "$FORGE_GIT_TOKEN"\n`, { mode: 0o700 });
    chmodSync(script, 0o700);
    const env: Record<string, string> = {
      ...baseEnv,
      GIT_ASKPASS: script,
      FORGE_GIT_TOKEN: token,
    };
    return { env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  /**
   * Construct the authenticated clone URL. The token is NOT embedded in the URL
   * (that would land in argv + the repo's stored remote); instead we set the
   * `x-access-token` username and let GIT_ASKPASS supply the secret. For a
   * non-https URL we pass it through unchanged.
   */
  private authUrl(url: string, token: string | undefined): string {
    if (!token) return url;
    const m = /^https:\/\/([^/]+)(\/.*)?$/.exec(url);
    if (!m) return url;
    const host = m[1].includes('@') ? m[1].slice(m[1].indexOf('@') + 1) : m[1];
    return `https://x-access-token@${host}${m[2] ?? ''}`;
  }

  async cloneRepo(args: CloneArgs): Promise<CloneResult> {
    args.onStatus?.('pulling');
    try {
      this.ensureRoot();
      const target = resolveCloneTarget(this.root, args.name);
      const { env, cleanup } = this.askpassEnv(args.token);
      try {
        const url = this.authUrl(args.url, args.token);
        const clone = await this.run(['clone', url, target], { cwd: this.root, env, timeoutMs: this.timeoutMs });
        if (clone.code !== 0) {
          throw new Error(`clone failed: ${scrub(clone.stderr || 'git exited non-zero', args.token).trim()}`);
        }
        const headSha = await this.headSha(target, env);
        const defaultBranch = await this.currentBranch(target, env);
        args.onStatus?.('cloned');
        return { pathOnDisk: target, defaultBranch, headSha };
      } finally {
        cleanup();
      }
    } catch (e) {
      args.onStatus?.('error');
      if (e instanceof PathEscapeError || e instanceof WorkspaceRootError) throw e;
      throw new Error(scrub((e as Error).message, args.token));
    }
  }

  async pullRepo(args: PullArgs): Promise<PullResult> {
    args.onStatus?.('pulling');
    try {
      const { env, cleanup } = this.askpassEnv(args.token);
      try {
        const pull = await this.run(['pull', '--ff-only'], { cwd: args.pathOnDisk, env, timeoutMs: this.timeoutMs });
        if (pull.code !== 0) {
          throw new Error(`pull failed: ${scrub(pull.stderr || 'git exited non-zero', args.token).trim()}`);
        }
        const headSha = await this.headSha(args.pathOnDisk, env);
        args.onStatus?.('cloned');
        return { headSha };
      } finally {
        cleanup();
      }
    } catch (e) {
      args.onStatus?.('error');
      throw new Error(scrub((e as Error).message, args.token));
    }
  }

  private async headSha(dir: string, env: Record<string, string>): Promise<string> {
    const r = await this.run(['rev-parse', 'HEAD'], { cwd: dir, env, timeoutMs: this.timeoutMs });
    return r.stdout.trim();
  }
  private async currentBranch(dir: string, env: Record<string, string>): Promise<string> {
    const r = await this.run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, env, timeoutMs: this.timeoutMs });
    return r.stdout.trim() || 'main';
  }
}
