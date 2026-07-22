import { readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { loopRun, type LoopRow, type LoopRunRow } from '@/db/schema/loop';
import type { LoopTrigger } from '@/db/enums';
import { getLoopKind } from '@/loops/kind-registry';
import {
  planPrompt, parsePlan, PLAN_OUTPUT_FORMAT,
  journalPrompt, parseJournal, JOURNAL_OUTPUT_FORMAT,
  type LoopPlan,
} from '@/loops/main-orchestration';

/**
 * Loop run engine. Ten stages per (repo, fire); the MMA main agent is consulted
 * at exactly two of them (one shared session), everything else is deterministic:
 *   1 preconditions (det) → 2 worktree (det) → 3 PLAN (main #1, opens session) →
 *   4 recall (worker fan-out) → 5 work (worker) → 6 verify (det run of the planned
 *   command) → 7 disposition/commit+PR (det) → 8 JOURNAL (main, resume) →
 *   9 record + report (det) → 10 cleanup (det, finally).
 * All IO is injected (`LoopRunDeps`) so the orchestration — every failure branch,
 * the never-PR-on-failed invariant, main-call fallbacks, and worktree cleanup on
 * every outcome — is testable with no real git / MMA / GitHub / database.
 */

export interface LoopRepoTarget {
  id: string;
  name: string;
  pathOnDisk: string;
}

export interface JournalEntry {
  tag: 'learned' | 'missed' | 'avoided';
  text: string;
}

/** What the MMA worker produced after running the goal in the worktree. */
export interface DispatchOutcome {
  mmaBatchId: string;
  keyChanges: string[]; // real changes only — verification + file list are separate
  filesChanged: string[];
}

export interface VerifyOutcome {
  command: string | null; // null = not_configured
  passed: boolean | null; // null when not_configured
  detail: string;
}

/**
 * Per-fire context. `runRowByRepoId` lets the caller pre-create the `running`
 * loop_run rows (so "Run now" reflects in the UI/history immediately) and have
 * the engine UPDATE them instead of inserting — falls back to inserting when absent.
 */
export interface RunContext {
  runId: string;
  trigger: LoopTrigger;
  goalOverride?: string;
  idempotencyKey?: string;
  reference?: string | null;
  context?: string | null;
  runRowByRepoId?: Map<string, string>;
}

/** One turn against the MMA main agent (orchestrator). `sessionId` resumes it next call. */
export interface MainTurn {
  output: string;
  sessionId: string | null;
}

export interface LoopRunDeps {
  db?: Db;
  /** A Connections Git token is configured (required to push + open PRs). */
  hasGitToken: () => boolean | Promise<boolean>;
  /** The repo is backed by a supported hosting provider (GitHub or GitLab) — required to push + open a PR/MR. */
  isSupportedRepo: (repo: LoopRepoTarget) => boolean | Promise<boolean>;
  /** The branch the repo is currently checked out on (the base when no targetBranch is set); null if detached/unresolvable. */
  resolveCurrentBranch: (repo: LoopRepoTarget) => Promise<string | null>;
  /** One main-agent (orchestrator) turn; pass `sessionId` to resume the same conversation. */
  mainSession: (args: { cwd: string; prompt: string; outputFormat?: string; sessionId?: string; loopRunId?: string }) => Promise<MainTurn>;
  /** Journal lookup for a query (empty string if the journal is absent). */
  recall: (repo: LoopRepoTarget, query: string, loopRunId?: string) => Promise<string>;
  /** Create an isolated worktree on `branch`, forked from the (freshly fetched) remote `baseBranch`. */
  createWorktree: (repo: LoopRepoTarget, branch: string, baseBranch: string) => Promise<{ path: string }>;
  /** Dispatch the MMA worker against the worktree; returns the work outcome. */
  dispatch: (args: {
    repo: LoopRepoTarget;
    cwd: string;
    prompt: string;
    workerTier: LoopRow['workerTier'];
    priorJournalContext: string;
    loopRunId?: string;
  }) => Promise<DispatchOutcome>;
  /** Run the verify command in the worktree (the planned command, or auto-detect when null). */
  runVerify: (repo: LoopRepoTarget, cwd: string, command: string | null) => Promise<VerifyOutcome>;
  /** Does the loop branch differ from `baseBranch`? (committed-ahead OR uncommitted — MMA merges the worker's commit into our branch.) */
  branchHasChanges: (cwd: string, baseBranch: string) => Promise<boolean>;
  /** Commit everything on `branch` + push; returns the commit SHA. */
  commitAndPush: (cwd: string, branch: string, message: string) => Promise<{ commitSha: string }>;
  /** Open a GitHub PR from `branch` into `base`; returns the PR URL. */
  openPr: (args: { repo: LoopRepoTarget; branch: string; base: string; title: string; body: string }) => Promise<{ prUrl: string }>;
  /** Record journal entries for the repo (initializes the journal if absent). */
  record: (repo: LoopRepoTarget, entries: JournalEntry[], loopRunId?: string) => Promise<void>;
  /** Remove the worktree (best-effort; runs after every outcome). */
  removeWorktree: (cwd: string) => Promise<void>;
  now?: () => Date;
}

function kebab(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'loop';
}

/** `loop/<slug>/<YYYY-MM-DD>`, with a short run-id suffix to avoid same-day collisions. */
export function buildBranch(loopName: string, date: Date, runId: string): string {
  const day = date.toISOString().slice(0, 10);
  return `loop/${kebab(loopName)}/${day}-${runId.slice(0, 8)}`;
}

function resolveGoalMd(loop: LoopRow, ctx: RunContext): string {
  const override = ctx.goalOverride?.trim();
  if (override) return override;
  const configGoal = (loop.config as { goalMd?: string } | null)?.goalMd?.trim();
  if (configGoal) return configGoal;
  return getLoopKind(loop.kind).buildPrompt(loop.config);
}

function buildWorkerPrompt(loop: LoopRow, ctx: RunContext, goalMd: string): string {
  const prompt = getLoopKind(loop.kind).buildPrompt({ ...(loop.config as object), goalMd });
  if (!ctx.context?.trim()) return prompt;
  return `${prompt}\n\n--- Context ---\n${ctx.context.trim()}\n--- End Context ---`;
}

function prBody(goal: string, verify: VerifyOutcome, keyChanges: string[], reference?: string | null, context?: string | null): string {
  const verifyLine =
    verify.command === null
      ? 'Verification: not configured.'
      : `Verification (\`${verify.command}\`): ${verify.passed ? 'PASS' : 'FAIL'} — ${verify.detail}`;
  return [
    '_Opened by a Forge maintenance loop. Review before merging — never auto-merged._',
    '',
    reference ? `Reference: ${reference}` : null,
    '',
    '## Goal',
    goal,
    '',
    context ? '## Context' : null,
    context ?? null,
    '',
    '## Key changes',
    ...keyChanges.map((c) => `- ${c}`),
    '',
    verifyLine,
  ].filter(Boolean).join('\n');
}

/**
 * Pre-compute repo context — a language-agnostic directory listing so the
 * planner knows what's in the repo without having to explore.
 */
async function buildRepoContext(cwd: string): Promise<string> {
  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => `${e.name}/`);
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    return `Top-level contents:\n${[...dirs, ...files].join('\n')}`;
  } catch { return ''; }
}

/** Run one repo within a fire. Persists + returns the `loop_run` row. */
export async function runLoopForRepo(
  loop: LoopRow,
  repo: LoopRepoTarget,
  ctx: RunContext,
  deps: LoopRunDeps,
): Promise<LoopRunRow> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? (() => new Date());
  const goalMd = resolveGoalMd(loop, ctx);
  const goal = buildWorkerPrompt(loop, ctx, goalMd);

  // Use the caller's pre-created running row when present; else insert one now.
  let runRowId = ctx.runRowByRepoId?.get(repo.id);
  if (!runRowId) {
    const [run] = await db
      .insert(loopRun)
      .values({
        teamId: loop.teamId,
        loopId: loop.id,
        runId: ctx.runId,
        repoId: repo.id,
        trigger: ctx.trigger,
        status: 'running',
        idempotencyKey: ctx.idempotencyKey ?? null,
        reference: ctx.reference ?? null,
      })
      .returning();
    runRowId = run.id;
  }

  const finish = async (
    patch: Partial<
      Pick<LoopRunRow, 'status' | 'branch' | 'prUrl' | 'mmaBatchId' | 'keyChanges' | 'verification' | 'filesChanged' | 'journalEntries' | 'reference'>
    >,
  ): Promise<LoopRunRow> => {
    const [updated] = await db
      .update(loopRun)
      .set({ ...patch, reference: ctx.reference ?? null, finishedAt: now() })
      .where(eq(loopRun.id, runRowId))
      .returning();
    return updated;
  };

  const failed = (text: string): Promise<LoopRunRow> =>
    finish({ status: 'failed', journalEntries: [{ tag: 'missed', text }] });

  // Step 0 — preconditions (fail before any MMA dispatch or push).
  if (!(await deps.hasGitToken())) return failed('missing_git_token: no Connections Git token configured');
  if (!(await deps.isSupportedRepo(repo))) return failed(`unsupported_provider: ${repo.name} is not backed by GitHub or GitLab`);
  // Base = the loop's target branch (forked from + PR'd into), else the branch the repo is currently on.
  const baseBranch = loop.targetBranch?.trim() || (await deps.resolveCurrentBranch(repo));
  if (!baseBranch) return failed(`missing_base_branch: cannot resolve a base branch for ${repo.name}`);

  const branch = buildBranch(loop.name, now(), ctx.runId);
  let worktree: string | null = null;
  try {
    // Stage 2 — worktree (forked from the freshly fetched remote base).
    worktree = (await deps.createWorktree(repo, branch, baseBranch)).path;

    // Stage 3 — PLAN (main #1, opens the session). Degrades to a one-recall, auto-detect
    // plan if the brain is unreachable or returns malformed JSON.
    // Pre-compute repo structure so the planner doesn't have to guess.
    const repoContext = await buildRepoContext(worktree);
    let plan: LoopPlan = { recalls: [{ query: goalMd }], verifyCommand: null };
    let sessionId: string | null = null;
    try {
      const planTurn = await deps.mainSession({ cwd: worktree, prompt: planPrompt(goalMd, repoContext), outputFormat: PLAN_OUTPUT_FORMAT, loopRunId: runRowId });
      sessionId = planTurn.sessionId;
      const parsed = parsePlan(planTurn.output);
      if (parsed) plan = parsed.recalls.length || parsed.verifyCommand ? parsed : plan;
    } catch {}

    // Stage 4 — recall (worker fan-out of the planned queries).
    const recallTexts: string[] = [];
    for (const r of plan.recalls) {
      const text = await deps.recall(repo, r.query, runRowId);
      if (text.trim()) recallTexts.push(r.purpose ? `### ${r.purpose}\n${text}` : text);
    }
    const priorJournalContext = recallTexts.join('\n\n');

    // Stage 5 — work (worker; static buildPrompt + recall context).
    const out = await deps.dispatch({ repo, cwd: worktree, prompt: goal, workerTier: loop.workerTier, priorJournalContext, loopRunId: runRowId });

    // Stage 6 — verify (deterministic run of the planned command; whatever it returns stands).
    const verify = await deps.runVerify(repo, worktree, plan.verifyCommand);
    const keyChanges = out.keyChanges;

    // Stage 7 — disposition. MMA's delegate runs in a nested worktree and merges
    // its commit back into our branch, so we detect work by comparing the loop
    // branch against the base branch (committed-ahead) — not `git status`, which
    // is clean once the change is committed. PR only when the branches differ.
    let status: LoopRunRow['status'] = 'no_changes';
    let prUrl: string | null = null;
    let branchOut: string | null = null;
    if (await deps.branchHasChanges(worktree, baseBranch)) {
      await deps.commitAndPush(worktree, branch, `loop(${loop.name}): ${repo.name}`);
      const pr = await deps.openPr({
        repo,
        branch,
        base: baseBranch,
        title: ctx.reference ? `loop(${loop.name}): ${ctx.reference}` : `loop(${loop.name}): ${repo.name}`,
        body: prBody(goalMd, verify, keyChanges, ctx.reference, ctx.context),
      });
      status = 'changed';
      prUrl = pr.prUrl;
      branchOut = branch;
    }

    // Stage 8 — JOURNAL (main, resume the session). Falls back to a single learned
    // line (the worker summary) only when the brain is unreachable / malformed.
    let journalEntries: JournalEntry[] = [{ tag: 'learned', text: keyChanges[0] ?? 'maintenance run complete' }];
    try {
      const jTurn = await deps.mainSession({
        cwd: worktree,
        prompt: journalPrompt({ goalMd, workerSummary: keyChanges[0] ?? '', filesChanged: out.filesChanged, verify }),
        outputFormat: JOURNAL_OUTPUT_FORMAT,
        sessionId: sessionId ?? undefined,
        loopRunId: runRowId,
      });
      const parsed = parseJournal(jTurn.output);
      if (parsed) journalEntries = parsed.entries;
    } catch {}

    // Stage 9 — record + report.
    if (journalEntries.length) await deps.record(repo, journalEntries, runRowId);
    return await finish({
      status,
      branch: branchOut,
      prUrl,
      mmaBatchId: out.mmaBatchId,
      keyChanges,
      verification: verify,
      filesChanged: out.filesChanged,
      journalEntries,
    });
  } catch (e) {
    return failed((e as Error)?.message ?? 'loop_run_failed');
  } finally {
    if (worktree) await deps.removeWorktree(worktree);
  }
}

/** Fan a fire out across the loop's target repos (shared `runId`). */
export async function runLoop(
  loop: LoopRow,
  repos: LoopRepoTarget[],
  ctx: RunContext,
  deps: LoopRunDeps,
): Promise<LoopRunRow[]> {
  const out: LoopRunRow[] = [];
  for (const repo of repos) out.push(await runLoopForRepo(loop, repo, ctx, deps));
  return out;
}
