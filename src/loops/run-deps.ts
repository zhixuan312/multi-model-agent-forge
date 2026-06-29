import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { connectionSettings } from '@/db/schema/config';
import { mmaBatch } from '@/db/schema/mma';
import { PostgresSecretStore } from '@/secrets/secret-store';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { nodeGitRunner, addWorktreeWithRetry } from '@/build/branch';
import { nodeCommandRunner } from '@/build/command-runner';
import { buildMmaClient } from '@/mma/server-client';
import type { LoopRunDeps, LoopRepoTarget } from '@/loops/run-engine';
import { extractUsageFields } from '@/usage/extract-usage-fields';

/**
 * Real `LoopRunDeps` wiring (spec §4 adapters). Reuses Forge's existing
 * infrastructure: `nodeGitRunner` (git), `nodeCommandRunner` (verify),
 * `buildMmaClient` (dispatch + journal), the Connections git token (push + PR).
 * The orchestration that composes these is unit-tested in run-engine.test; this
 * module is the thin IO layer (integration-verified).
 */

async function readGitToken(db: Db): Promise<string | null> {
  const [row] = await db.select({ ref: connectionSettings.gitTokenRef }).from(connectionSettings).limit(1);
  if (!row?.ref) return null;
  const secrets = await PostgresSecretStore.create({ db });
  return secrets.get(row.ref);
}

/** Parse a github owner/repo from a remote URL (ssh or https), else null. */
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function git(cwd: string, argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return nodeGitRunner(cwd, argv);
}

async function githubRemote(repo: LoopRepoTarget): Promise<{ owner: string; repo: string } | null> {
  const r = await git(repo.pathOnDisk, ['remote', 'get-url', 'origin']);
  return r.code === 0 ? parseGithubRemote(r.stdout) : null;
}

/**
 * Serialize git ops that mutate a repo's shared `.git` (worktree add/remove) so
 * concurrent loop runs on the SAME repo don't race the config lock
 * ("could not lock config file .git/config: File exists"). Keyed by the repo's
 * common git dir, so a worktree path and its origin repo share one queue.
 */
const repoGitLocks = new Map<string, Promise<unknown>>();
async function gitCommonDir(path: string): Promise<string> {
  const r = await git(path, ['rev-parse', '--git-common-dir']);
  if (r.code !== 0) return path;
  const dir = r.stdout.trim();
  return dir.startsWith('/') ? dir : join(path, dir);
}
async function withRepoGitLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = await gitCommonDir(path);
  const prev = repoGitLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run after the prior op settles (success or failure)
  repoGitLocks.set(key, run.then(() => {}, () => {}));
  return run;
}

interface ReportFinding {
  severity?: string;
  category?: string;
  description?: string;
  claim?: string;
  location?: string;
}

/**
 * Workers often answer with a JSON report (`{findings, summary, verdict}`) as
 * their summary text. Unwrap it to the prose summary + structured findings so
 * we never store a raw JSON blob as a "key change".
 */
function unwrapReport(text: string | undefined): { summary: string; findings: ReportFinding[] } | null {
  if (!text) return null;
  // Tolerate a ```json fence and/or surrounding prose: pull out the {…} object.
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { summary?: unknown; findings?: unknown };
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const findings = Array.isArray(parsed.findings) ? (parsed.findings as ReportFinding[]) : [];
    if (!summary && findings.length === 0) return null; // not a report shape
    return { summary, findings };
  } catch {
    return null;
  }
}

/** Summarize a delegate envelope into changes + touched files. */
export function summarizeEnvelope(env: unknown): { keyChanges: string[]; filesChanged: string[] } {
  const e = (env ?? {}) as {
    output?: { summary?: unknown; filesChanged?: string[] };
  };
  const out = e.output;
  const filesChanged = out?.filesChanged ?? [];
  const rawText = typeof out?.summary === 'string' ? out.summary
    : (out?.summary && typeof out.summary === 'object') ? (out.summary as Record<string, unknown>).answer as string ?? ''
    : '';
  const report = unwrapReport(rawText);

  const summary = report?.summary || (report ? '' : rawText);
  const findings: ReportFinding[] = report?.findings ?? [];

  // Each finding becomes a readable "key change" line — never raw JSON. File
  // counts + verification are NOT changes; they live in their own slots.
  const findingLines = findings
    .map((f) => {
      const head = [f.category, f.severity].filter(Boolean).join(' / ');
      const body = (f.description ?? f.claim ?? '').trim();
      const loc = f.location ? ` (${f.location})` : '';
      return `${head ? `${head}: ` : ''}${body}${loc}`.trim();
    })
    .filter(Boolean);

  const keyChanges: string[] = [];
  if (summary) keyChanges.push(summary);
  keyChanges.push(...findingLines);
  if (keyChanges.length === 0) keyChanges.push('maintenance run complete');

  return { keyChanges, filesChanged };
}

export function buildLoopRunDeps(deps: { db?: Db } = {}): LoopRunDeps {
  const db = deps.db ?? getDb();

  return {
    db,
    hasGitToken: async () => !!(await readGitToken(db)),
    isGithubRepo: async (repo) => (await githubRemote(repo)) !== null,
    resolveCurrentBranch: async (repo) => {
      const r = await git(repo.pathOnDisk, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (r.code !== 0) return null;
      const ref = r.stdout.trim();
      return ref && ref !== 'HEAD' ? ref : null; // 'HEAD' = detached → unresolvable
    },
    mainSession: async ({ cwd, prompt, outputFormat, sessionId, loopRunId }) => {
      const mma = await buildMmaClient({ db });
      const body: Record<string, unknown> = { type: 'orchestrate', prompt, reviewPolicy: 'none' };
      if (outputFormat) body.outputFormat = outputFormat;
      const env = await mma.dispatchAndWait('orchestrate', { cwd, body });
      const usage = extractUsageFields(env);
      await db
        .insert(mmaBatch)
        .values({
          projectId: null,
          route: 'orchestrate',
          cwd,
          status: 'done',
          request: { type: 'main', prompt: prompt.slice(0, 200) },
          result: env as object,
          terminalAt: new Date(),
          ...(loopRunId && { loopRunId }),
          ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
          ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
          ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
          ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
          ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
          ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
        })
        .catch(() => {});
      // v5.4+ envelope: output.summary holds the response text
      const e = (env ?? {}) as Record<string, unknown>;
      const output = (e.output ?? {}) as Record<string, unknown>;
      const summaryRaw = output.summary;
      const text = typeof summaryRaw === 'string' ? summaryRaw
        : (summaryRaw && typeof summaryRaw === 'object') ? JSON.stringify(summaryRaw) : '';
      return {
        output: text,
        sessionId: null, // session resume removed in unified task API
      };
    },
    recall: async (_repo, query, loopRunId) => {
      const workspaceRoot = resolveWorkspaceRoot();
      if (!existsSync(join(workspaceRoot, '.mma', 'journal'))) return '';
      try {
        const mma = await buildMmaClient({ db });
        const env = await mma.dispatchAndWait('journal-recall', {
          cwd: workspaceRoot,
          body: { type: 'journal_recall', prompt: query.slice(0, 4000), reviewPolicy: 'none' },
        });
        const usage = extractUsageFields(env);
        await db
          .insert(mmaBatch)
          .values({
            projectId: null,
            route: 'journal_recall',
            cwd: workspaceRoot,
            status: 'done',
            request: { query: query.slice(0, 200) },
            result: env as object,
            terminalAt: new Date(),
            ...(loopRunId && { loopRunId }),
            ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
            ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
            ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
            ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
            ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
            ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
            ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
          })
          .catch(() => {});
        const e = (env ?? {}) as Record<string, unknown>;
        const recallOutput = (e.output ?? {}) as Record<string, unknown>;
        const recallSummary = recallOutput.summary;
        return typeof recallSummary === 'string' ? recallSummary : '';
      } catch {
        return '';
      }
    },
    createWorktree: async (repo, branch, baseBranch) =>
      // Serialized per repo: concurrent runs on the same clone otherwise collide on
      // the .git config lock during `worktree add`.
      withRepoGitLock(repo.pathOnDisk, async () => {
        await git(repo.pathOnDisk, ['worktree', 'prune']); // clear prunable leftovers (e.g. from a crashed run)
        // Fork from the FRESH remote base if the branch is pushed (it may have moved
        // since clone); fall back to the local branch when it isn't on the remote.
        await git(repo.pathOnDisk, ['fetch', 'origin', baseBranch]);
        const remoteRef = `origin/${baseBranch}`;
        const hasRemote = (await git(repo.pathOnDisk, ['rev-parse', '--verify', '--quiet', remoteRef])).code === 0;
        const baseRef = hasRemote ? remoteRef : baseBranch;
        // Stable worktree location beside the repo (NOT the OS temp dir, which can be
        // reaped mid-run, taking the worktree cwd with it). Removed by removeWorktree.
        const worktreeRoot = join(dirname(repo.pathOnDisk), '.forge-loop-worktrees');
        mkdirSync(worktreeRoot, { recursive: true });
        const path = mkdtempSync(join(worktreeRoot, 'wt-'));
        // Cleanup-aware retry: concurrent same-repo adds race the shared .git/config
        // lock, and a partial add leaves the branch behind (a blind retry would then
        // fail "branch already exists"). addWorktreeWithRetry tears down partial state
        // between attempts so N concurrent loop runs each get their own worktree.
        const r = await addWorktreeWithRetry(nodeGitRunner, repo.pathOnDisk, branch, path, baseRef);
        if (r.code !== 0) throw new Error(`git worktree add failed: ${r.stderr}`);
        return { path };
      }),
    dispatch: async ({ repo, cwd, prompt, workerTier, priorJournalContext, loopRunId }) => {
      const mma = await buildMmaClient({ db });
      const fullPrompt = priorJournalContext
        ? `${prompt}\n\n## Prior journal context\n\n${priorJournalContext}`
        : prompt;
      const body = { type: 'delegate' as const, prompt: fullPrompt, reviewPolicy: 'reviewed' };
      const env = await mma.dispatchAndWait('delegate', { cwd, body });
      const usage = extractUsageFields(env);
      const [batch] = await db
        .insert(mmaBatch)
        .values({
          projectId: null,
          route: 'delegate',
          targetRepoId: repo.id,
          cwd,
          status: 'done',
          request: body,
          result: env as object,
          terminalAt: new Date(),
          ...(loopRunId && { loopRunId }),
          ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
          ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
          ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
          ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
          ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
          ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
        })
        .returning({ id: mmaBatch.id });
      return { mmaBatchId: batch.id, ...summarizeEnvelope(env) };
    },
    runVerify: async (_repo, cwd, command) => {
      // Run the main-agent's chosen command if it gave one; otherwise fall back to
      // an `npm test` probe (no per-repo verify registry yet → run the repo's test
      // script if a package.json exists, else not_configured).
      if (command && command.trim()) {
        const argv = command.trim().split(/\s+/);
        const outcome = await nodeCommandRunner.run(argv, { cwd });
        return {
          command: command.trim(),
          passed: outcome.kind === 'pass',
          detail: outcome.kind === 'pass' ? 'passed' : `${outcome.kind}`,
        };
      }
      const hasPkg = (await git(cwd, ['ls-files', 'package.json'])).stdout.includes('package.json');
      if (!hasPkg) return { command: null, passed: null, detail: 'no test command configured' };
      const outcome = await nodeCommandRunner.run(['npm', 'test', '--silent'], { cwd });
      return {
        command: 'npm test',
        passed: outcome.kind === 'pass',
        detail: outcome.kind === 'pass' ? 'tests passed' : `tests ${outcome.kind}`,
      };
    },
    branchHasChanges: async (cwd, baseBranch) => {
      // MMA merges the worker's commit into our branch, so uncommitted-only checks
      // miss it. Ground truth = does our branch differ from the base it forked from?
      // Catch both committed-ahead (vs origin/<base>) and any uncommitted leftovers.
      const porcelain = (await git(cwd, ['status', '--porcelain'])).stdout.trim();
      if (porcelain) return true;
      const ahead = (await git(cwd, ['rev-list', '--count', `origin/${baseBranch}..HEAD`])).stdout.trim();
      return parseInt(ahead || '0', 10) > 0;
    },
    commitAndPush: async (cwd, branch, message) => {
      await git(cwd, ['add', '-A']);
      await git(cwd, ['-c', 'user.email=loops@forge.local', '-c', 'user.name=Forge Loops', 'commit', '-m', message]);
      const sha = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
      const token = await readGitToken(db);
      const gh = await githubRemote({ id: '', name: '', pathOnDisk: cwd });
      if (token && gh) {
        const authUrl = `https://x-access-token:${token}@github.com/${gh.owner}/${gh.repo}.git`;
        await git(cwd, ['push', authUrl, `HEAD:${branch}`]);
      } else {
        await git(cwd, ['push', 'origin', `HEAD:${branch}`]);
      }
      return { commitSha: sha };
    },
    openPr: async ({ repo, branch, base, title, body }) => {
      const token = await readGitToken(db);
      const gh = await githubRemote(repo);
      if (!token || !gh) throw new Error('cannot open PR: missing git token or non-GitHub remote');
      const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/pulls`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title, head: branch, base, body }),
      });
      if (!res.ok) throw new Error(`GitHub PR creation failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { html_url: string };
      return { prUrl: json.html_url };
    },
    record: async (_repo, entries, loopRunId) => {
      try {
        const mma = await buildMmaClient({ db });
        const text = entries.map((e) => `- [${e.tag}] ${e.text}`).join('\n');
        const workspaceRoot = resolveWorkspaceRoot();
        const env = await mma.dispatchAndWait('journal-record', { cwd: workspaceRoot, body: { type: 'journal_record', prompt: `Record the following learnings to the team journal:\n\n${text}` } });
        const usage = extractUsageFields(env);
        await db
          .insert(mmaBatch)
          .values({
            projectId: null,
            route: 'journal_record',
            cwd: workspaceRoot,
            status: 'done',
            request: { learnings: text.slice(0, 200) },
            result: env as object,
            terminalAt: new Date(),
            ...(loopRunId && { loopRunId }),
            ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
            ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
            ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
            ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
            ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
            ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
            ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
          })
          .catch(() => {});
      } catch {
        /* journal record is best-effort; a failure must not fail the run */
      }
    },
    removeWorktree: async (cwd) => {
      // `cwd` is the worktree path; remove it from whichever repo owns it. Serialized
      // per repo (shares the createWorktree queue) so it can't race another run's add.
      await withRepoGitLock(cwd, () =>
        nodeGitRunner(cwd, ['worktree', 'remove', '--force', cwd]).catch(() => ({ code: 1, stdout: '', stderr: '' })),
      );
    },
  };
}
