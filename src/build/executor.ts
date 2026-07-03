import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { MmaClient } from '@/mma/client';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { GitOps } from '@/build/branch';
import { ensureForgeExcluded, planFilePath, nodePlanFs, type PlanFs } from '@/build/plan-fs';
import { parseExecuteEnvelope, classifyExecute } from '@/build/execute-envelope';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { inferCommands, cmdToString, type ManifestSnapshot } from '@/build/command-inference';
import { type CommandRunner } from '@/build/command-runner';
import { updateDetails } from '@/details/write';
import type { Details } from '@/details/schema';

/**
 * Per-task executor (Spec 7 §Execute steps 1–4; the 7b core). Drives ONE
 * plan task: prep branch → dispatch execute-plan → poll terminal → classify →
 * verify (commit payload + self-commit + build/test + non-empty diff) → inline-fix
 * loop → commit / fail / halt. Every effectful dep is injected (MmaClient,
 * GitOps, CommandRunner, the inline-fix function) so tests use fakes and NEVER run
 * a real execute-plan or mutate a real repo.
 */

const MAX_INLINE_FIX_ATTEMPTS = 3;

export interface RepoContext {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
  /** First task targeting this repo this run? (drives checkout -b vs assert.) */
  firstTask: boolean;
}

export interface PlanTaskView {
  id: string;
  title: string;
  status: string;
  reviewPolicy: 'reviewed' | 'none';
  targetRepoId: string;
  orderIndex: number;
  dependsOn?: string[];
  phase?: string;
  branch?: string;
  targetBranch?: string;
  commitSha?: string;
  fixNote?: string;
  mmaBatchId?: string;
  meta?: Record<string, unknown>;
}

/** The main-agent inline fix (a MAIN-AGENT action, not an MMA dispatch). */
export type InlineFixFn = (args: {
  task: PlanTaskView;
  repo: RepoContext;
  outputTail: string;
}) => Promise<{ note: string }>;

export interface ExecutorDeps {
  db?: Db;
  mma: MmaClient;
  git: GitOps;
  command: CommandRunner;
  fs?: PlanFs;
  bus?: ProjectEventBus;
  /** Resolve a repo's manifest snapshot for command inference (tests inject). */
  readManifest: (repo: RepoContext) => Promise<ManifestSnapshot>;
  /** The main-agent inline fix (edits files directly, then returns a note). */
  inlineFix: InlineFixFn;
  /** Poll cadence override (tests fast-poll). Default 25ms. */
  pollIntervalMs?: number;
}

export type TaskOutcome =
  | { status: 'committed'; commitSha: string }
  | { status: 'failed'; reason: string }
  | { status: 'halt'; marker: string };

/** Update a plan task's fields in details. */
async function updateTask(
  db: Db,
  projectId: string,
  taskId: string,
  patch: Partial<Details['stages']['plan']['phases']['refine']['tasks'][0]>,
): Promise<void> {
  await updateDetails(db, projectId, (d) => {
    const t = d.stages.plan.phases.refine.tasks.find((x) => x.id === taskId);
    if (t) Object.assign(t, patch);
    return d;
  });
}

/** Run one plan task to its terminal outcome. */
export async function executeTask(
  deps: ExecutorDeps,
  args: { task: PlanTaskView; repo: RepoContext; projectId: string; actorId: string },
): Promise<TaskOutcome> {
  const db = deps.db ?? getDb();
  const bus = deps.bus ?? projectEventBus;
  const fs = deps.fs ?? nodePlanFs;
  const { task, repo, projectId } = args;

  // 1. Prepare the branch BEFORE dispatch (+ .forge git hygiene on first task).
  let prepared;
  try {
    if (repo.firstTask) await ensureForgeExcluded(fs, repo.pathOnDisk);
    prepared = await deps.git.prepareBranch({
      repoPath: repo.pathOnDisk,
      projectId,
      repoName: repo.name,
      defaultBranch: repo.defaultBranch,
      firstTask: repo.firstTask,
    });
  } catch (err) {
    const reason = (err as Error).message;
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
    return { status: 'failed', reason };
  }

  await updateTask(db, projectId, task.id, { branch: prepared.branch, status: 'executing' });
  bus.publish(projectId, {
    type: 'task.executing',
    taskId: task.id,
    repo: repo.name,
    branch: prepared.branch,
    title: task.title,
  });

  // 2. Dispatch execute-plan (one task per dispatch), record the mma_batch row.
  const planPath = planFilePath(repo.pathOnDisk, projectId);
  let batchId: string;
  try {
    ({ batchId } = await deps.mma.executePlan(repo.pathOnDisk, {
      planPath,
      tasks: [task.title],
      reviewPolicy: task.reviewPolicy,
    }));
  } catch (err) {
    const reason = `dispatch failed: ${(err as Error).message}`;
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
    return { status: 'failed', reason };
  }

  const [batchRow] = await db
    .insert(mmaBatch)
    .values({
      projectId,
      route: 'execute_plan',
      targetRepoId: repo.id,
      cwd: repo.pathOnDisk,
      batchId,
      status: 'dispatched',
      request: { planPath, tasks: [task.title], reviewPolicy: task.reviewPolicy },
      dispatchedBy: args.actorId,
    })
    .returning({ id: mmaBatch.id });
  await updateTask(db, projectId, task.id, { mmaBatchId: batchRow.id });

  // 3. Poll to terminal + persist the envelope + usage columns.
  const envelope = await pollToTerminal(deps.mma, batchId, deps.pollIntervalMs ?? 25);
  const usage = extractUsageFields(envelope);
  await db
    .update(mmaBatch)
    .set({
      status: 'done',
      result: envelope as object,
      terminalAt: new Date(),
      ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
      ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
      ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
      ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
      ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
      ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
      ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
    })
    .where(eq(mmaBatch.id, batchRow.id));

  const parsed = parseExecuteEnvelope(envelope);
  // Cost tick (observability only).
  bus.publish(projectId, {
    type: 'cost.tick',
    runCostUsd: parsed.costUsd,
    byRoute: { audit: 0, executePlan: parsed.costUsd, review: 0 },
  });

  const disposition = classifyExecute(parsed);
  if (disposition.kind === 'halt') {
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason: `halt: ${disposition.marker}` });
    return { status: 'halt', marker: disposition.marker };
  }
  if (disposition.kind === 'failure') {
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason: disposition.reason });
    return { status: 'failed', reason: disposition.reason };
  }

  const commitSha = disposition.commitSha;
  await updateTask(db, projectId, task.id, { commitSha, status: 'verifying' });
  bus.publish(projectId, { type: 'task.verifying', taskId: task.id });

  // 4. Self-commit check — ONCE, before any inline fix.
  const newCommits = await deps.git.commitsSince(repo.pathOnDisk, prepared.headBefore);
  const selfCommitOk = newCommits.length === 1 && newCommits[0] === commitSha;
  if (!selfCommitOk) {
    const reason = `worker may have self-committed — diff suspect (${newCommits.length} commit(s) in head_before..HEAD)`;
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
    return { status: 'failed', reason };
  }

  // Non-empty diff (the falsely-not-implemented trap).
  const hasDiff = await deps.git.hasDiffSince(repo.pathOnDisk, prepared.headBefore);
  if (!hasDiff) {
    const reason = 'empty diff after commit — nothing implemented on disk';
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
    return { status: 'failed', reason };
  }

  // 5. Build/test gate — inferred commands, persisted to meta.{buildCmd,testCmd}.
  const manifest = await deps.readManifest(repo);
  const { build, test } = inferCommands(manifest);
  const meta: Record<string, unknown> = { buildCmd: cmdToString(build), testCmd: cmdToString(test) };
  await updateTask(db, projectId, task.id, { meta });

  // F16: a review_policy='none' (intentionally-incomplete) task DEFERS build+test.
  if (task.reviewPolicy === 'none') {
    return await commitTask(db, bus, projectId, task.id, commitSha);
  }

  // Run build, then test (each present sub-gate must pass; absent = vacuous pass).
  const gate = await runBuildTest(deps.command, repo.pathOnDisk, build, test);
  if (gate.ok) {
    return await commitTask(db, bus, projectId, task.id, commitSha);
  }
  if (gate.envError) {
    const reason = `environment error: ${gate.detail}`;
    await updateTask(db, projectId, task.id, { status: 'failed' });
    bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
    return { status: 'failed', reason };
  }

  // 6. Inline-fix loop (main-agent action; Forge commits the fix). Capped.
  let lastTail = gate.detail;
  let metaForFix = meta;
  for (let attempt = 1; attempt <= MAX_INLINE_FIX_ATTEMPTS; attempt++) {
    await updateTask(db, projectId, task.id, { status: 'fixing' });
    const { note } = await deps.inlineFix({ task, repo, outputTail: lastTail });
    bus.publish(projectId, { type: 'task.fixing', taskId: task.id, note });

    const fixSha = await deps.git.commitInlineFix(repo.pathOnDisk, `fix: ${note}`);
    metaForFix = { ...metaForFix, fixCommitSha: fixSha };
    await updateTask(db, projectId, task.id, { fixNote: note, meta: metaForFix });
    bus.publish(projectId, { type: 'task.fixed', taskId: task.id, note });

    // Post-fix re-verification is build+test ONLY (self-commit check is not re-run).
    const reGate = await runBuildTest(deps.command, repo.pathOnDisk, build, test);
    if (reGate.ok) {
      return await commitTask(db, bus, projectId, task.id, commitSha);
    }
    if (reGate.envError) {
      const reason = `environment error: ${reGate.detail}`;
      await updateTask(db, projectId, task.id, { status: 'failed' });
      bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
      return { status: 'failed', reason };
    }
    lastTail = reGate.detail;
  }

  const reason = `build/test still failing after ${MAX_INLINE_FIX_ATTEMPTS} inline-fix attempts — lane halted`;
  await updateTask(db, projectId, task.id, { status: 'failed' });
  bus.publish(projectId, { type: 'build.task_failed', taskId: task.id, reason });
  return { status: 'failed', reason };
}

interface GateResult {
  ok: boolean;
  envError: boolean;
  detail: string;
}

/** Run the present build + test sub-gates. Absent command = vacuous pass. */
async function runBuildTest(
  runner: CommandRunner,
  cwd: string,
  build: string[] | null,
  test: string[] | null,
): Promise<GateResult> {
  for (const argv of [build, test]) {
    if (!argv) continue; // vacuous pass for an absent sub-gate
    const outcome = await runner.run(argv, { cwd });
    if (outcome.kind === 'pass') continue;
    if (outcome.kind === 'env_error') return { ok: false, envError: true, detail: outcome.detail };
    if (outcome.kind === 'timeout') return { ok: false, envError: false, detail: 'command exceeded BUILD_TEST_TIMEOUT_MS' };
    return { ok: false, envError: false, detail: outcome.outputTail };
  }
  return { ok: true, envError: false, detail: '' };
}

async function commitTask(
  db: Db,
  bus: ProjectEventBus,
  projectId: string,
  taskId: string,
  commitSha: string,
): Promise<TaskOutcome> {
  await updateTask(db, projectId, taskId, { status: 'committed' });
  bus.publish(projectId, { type: 'task.committed', taskId, commitSha });
  return { status: 'committed', commitSha };
}

async function pollToTerminal(mma: MmaClient, batchId: string, intervalMs: number): Promise<unknown> {
  for (;;) {
    const r = await mma.poll(batchId);
    if (r.state === 'terminal') return r.envelope;
    if (r.state === 'not_found') throw new Error(`MMA task ${batchId} no longer exists (404) — server may have restarted.`);
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
