import { eq, and, inArray, sql, asc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { qaMessage } from '@/db/schema/spec';
import { specFilePath, planFilePath, readSpecFileAsync, readPlanFileAsync, backupArtifact } from '@/projects/project-files';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { projectEventBus } from '@/sse/event-bus';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { updateDetails, advanceStage, advancePhase, reopenStage, setAutomationStatus } from '@/details/write';
import { releaseDriverLease } from '@/automation/driver-lease';
import type { StageKind } from '@/db/enums';
import { validateDetails } from '@/details/schema';
import { lastReadBlockId } from '@/details/read';
import {
  recordAuthorAttempt, recordTaskValidation, recordHarvestAttempt, openRunningAttempts,
} from '@/automation/details-mutations';
import { startExecuteRun } from '@/build/start-execute-run';
import { parseAuditEnvelope } from '@/spec/audit-loop';
import { extractReviewFindings, buildReviewFixPrompt, type RawReviewFinding } from '@/review/review-findings';
import type { AutoAction } from '@/automation/details-resolver';

/** Outcome of an action: `inflight` means an MMA batch for this (project, handler)
 * is already dispatched/running, so the driver must WAIT rather than record a step. */
export type ActionResult = 'ok' | 'inflight';

/**
 * Maps each MMA-dispatching action to the `ops_mma_batch.handler` it would fire.
 * The DB is the single source of truth for "is one already in flight?" — every
 * such action is checked against it BEFORE dispatch (see the guard below).
 */
const MMA_HANDLER_FOR: Record<string, (a: AutoAction) => string> = {
  dispatch_audit: (a) => `${a.stage === 'spec' ? 'spec' : 'plan'}-audit`,
  apply_findings: (a) => `${a.stage === 'spec' ? 'spec' : 'plan'}-audit-apply`,
  dispatch_plan_author: () => 'plan-author',
  validate_task: () => 'plan-refine',
  dispatch_execute: () => 'execute-pipeline',
  dispatch_review: () => 'code-review',
  apply_review_findings: () => 'review-apply',
  dispatch_harvest: () => 'journal-harvest',
  dispatch_record: () => 'journal-record',
  // Design-phase (manual-only) dispatches — Task 8b
  propose_discover_tasks: () => 'explore-propose',
  dispatch_synthesize: () => 'explore-synthesize',
  refine_component: () => 'spec-refine',
  // NOTE: run_discover_tasks is intentionally absent — it fans out to N per-task
  // batches (no single handler to key on) and is manual-only (auto never drives
  // exploration), so it needs neither the single-flight inflightGuard nor a
  // batch-terminal line resolver.
};

/** Whether an action dispatches an MMA batch (→ its running timeline line is
 * resolved by the batch terminal) vs. a synchronous approval/advance (→ the driver
 * resolves its own line immediately). Single source: the handler map above. */
export function isBatchBackedAction(kind: string): boolean {
  return kind in MMA_HANDLER_FOR;
}

/**
 * Never fire a second MMA task for a (project, handler) while one is already
 * dispatched/running — a duplicate races the same on-disk artifact and burns a
 * concurrent LLM run. No actor filter: any in-flight batch (auto OR manual)
 * counts. A prior `failed`/`done` batch does NOT match, so retries proceed.
 */
async function inflightGuard(db: Db, projectId: string, handler: string): Promise<boolean> {
  const existing = await findInflight(db, projectId, handler);
  return existing !== null;
}

/**
 * CENTRALIZED reconcile for EVERY async-dispatched attempt (plan-author, execute,
 * and any future async route — see `RECONCILABLE_ATTEMPTS`). An attempt is recorded
 * `running` at dispatch and closed to `done` by its terminal handler, but the
 * handler only runs on SUCCESS. If the batch ends `failed`, the attempt is left
 * `running` and a WAITing resolver would deadlock forever. This ONE function (not a
 * bespoke reconcile per handler) flips every such `running` attempt whose MMA batch
 * is terminal-`failed` to `failed`, so the resolver re-dispatches (bounded by the
 * in-flight guard). All open attempts are checked in a single batch query.
 */
export async function reconcileStuckAttempts(db: Db, projectId: string): Promise<void> {
  const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!pRow?.details) return;
  const d = validateDetails(pRow.details);
  const open = openRunningAttempts(d).filter((x) => x.attempt.batchId);
  if (open.length === 0) return;
  const failedRows = await db
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(and(inArray(mmaBatch.id, open.map((x) => x.attempt.batchId!)), eq(mmaBatch.status, 'failed')));
  const failed = new Set(failedRows.map((r) => r.id));
  const toFlip = open.filter((x) => failed.has(x.attempt.batchId!));
  if (toFlip.length === 0) return;
  const at = new Date().toISOString();
  // Flip in ONE updateDetails (re-find the live attempts on the fresh details) and
  // append a durable error line; mirror it live so the UI shows the retry at once.
  await updateDetails(db, projectId, (det) => {
    const stuck = new Set(toFlip.map((x) => x.attempt.batchId));
    for (const { stage, phase, label, attempt } of openRunningAttempts(det)) {
      if (attempt.batchId && stuck.has(attempt.batchId)) {
        attempt.status = 'failed';
        det.events.push({ stage, phase, detail: `${label} failed — retrying`, kind: 'error', at });
      }
    }
    return det;
  });
  for (const { stage, phase, label } of toFlip) {
    projectEventBus.publish(projectId, { type: 'automation.progress', note: `${label} failed — retrying`, stage, phase, kind: 'error' });
  }
}

export async function executeDetailsAction(projectId: string, action: AutoAction, db: Db = getDb()): Promise<ActionResult> {
  const cwd = resolveWorkspaceRoot();
  const mma = await buildMmaClient({ db });

  // DB (ops_mma_batch) is the source of truth: before firing ANY MMA request for
  // this (project, handler), refuse if one is already dispatched/running. The
  // driver treats 'inflight' as WAIT. Absent/failed prior batches do not match,
  // so a first dispatch or a retry-after-failure proceeds.
  const handlerFor = MMA_HANDLER_FOR[action.kind];
  if (handlerFor && (await inflightGuard(db, projectId, handlerFor(action)))) {
    return 'inflight';
  }

  switch (action.kind) {
    case 'dispatch_audit': {
      const scope = action.stage === 'spec' ? 'spec' : 'plan';
      const filePath = scope === 'spec' ? specFilePath(projectId) : planFilePath(projectId);
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      const passes = pRow?.details
        ? (scope === 'spec'
            ? validateDetails(pRow.details).stages.spec.phases.finalize.auditPasses
            : validateDetails(pRow.details).stages.plan.phases.validate.auditPasses)
        : [];
      const prevBlockId = lastReadBlockId(passes[passes.length - 1]?.audit?.attempts);
      await dispatchMma({
        db, mma, projectId, route: 'audit', handler: `${scope}-audit`, cwd,
        body: { subtype: scope, target: { paths: [filePath] }, ...(prevBlockId ? { contextBlockIds: [prevBlockId] } : {}) },
        actorId: FORGE_MEMBER_ID, await: true,
      });
      break;
    }

    case 'apply_findings': {
      const scope = action.stage === 'spec' ? 'spec' : 'plan';
      const filePath = scope === 'spec' ? specFilePath(projectId) : planFilePath(projectId);
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      const passes = scope === 'spec'
        ? d.stages.spec.phases.finalize.auditPasses
        : d.stages.plan.phases.validate.auditPasses;
      const lastPass = passes[passes.length - 1];
      if (!lastPass?.audit?.attempts?.[0]?.batchId) break;
      const [batch] = await db.select({ result: mmaBatch.result }).from(mmaBatch)
        .where(eq(mmaBatch.id, lastPass.audit.attempts[0].batchId)).limit(1);
      if (!batch?.result) break;
      // Use the CANONICAL audit parser (the same one that set this pass's `revised`
      // verdict) — a `revised` pass therefore always yields non-empty findings here,
      // so apply_findings can never spin on an empty list (the old object-only
      // `extractFindings` diverged from the string-aware verdict → infinite loop).
      const parsed = parseAuditEnvelope(batch.result);
      const allFindings = parsed.kind === 'report' ? parsed.findings : [];
      // Manual subset apply: the client may pass `findingIndices` — positions in the
      // parsed findings array. auditPassHistory (the client's findings source) runs the
      // SAME parser, so a checked row's index maps 1:1 to `allFindings` here. No indices
      // (auto mode, or "Apply all") → fix every finding, preserving prior behavior.
      const selRaw = (action.data as { findingIndices?: unknown } | undefined)?.findingIndices;
      const selected = Array.isArray(selRaw)
        ? selRaw.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < allFindings.length)
        : [];
      const findings = selected.length > 0 ? selected.map((i) => allFindings[i]) : allFindings;
      if (findings.length === 0) break;
      await backupArtifact(projectId, scope === 'spec' ? 'spec.md' : 'plan.md');
      const prompt = buildRevisePrompt(filePath, findings);
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: `${scope}-audit-apply`, cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, await: true,
      });
      break;
    }

    case 'approve_stage': {
      if (action.stage === 'spec') {
        // Finalize = spec-level sign-off (whole spec), NOT the per-component
        // Craft approvals. Forge signs the finalize.approvals array.
        await updateDetails(db, projectId, (d) => {
          if (!d.stages.spec.phases.finalize.approvals.includes(FORGE_MEMBER_ID)) {
            d.stages.spec.phases.finalize.approvals.push(FORGE_MEMBER_ID);
          }
          return d;
        });
        await advanceStage(db, projectId, 'plan');
      } else if (action.stage === 'plan') {
        await updateDetails(db, projectId, (d) => {
          if (!d.stages.plan.participants.includes(FORGE_MEMBER_ID)) d.stages.plan.participants.push(FORGE_MEMBER_ID);
          return d;
        });
        await advanceStage(db, projectId, 'execute');
      }
      break;
    }

    case 'advance_stage': {
      const toStage = action.stage as 'review' | 'journal';
      await advanceStage(db, projectId, toStage);
      break;
    }

    case 'reopen_stage': {
      // Completion-invariant recovery: a stage was marked done without doing its
      // work. Reopen it (+ reset everything downstream) so the pipeline redoes it.
      await reopenStage(db, projectId, action.stage as StageKind);
      break;
    }

    case 'advance_phase': {
      const toPhase = action.phase;
      await advancePhase(db, projectId, action.stage as any, toPhase);
      break;
    }

    case 'dispatch_plan_author': {
      // In-flight already ruled out by the top-of-function guard. Dispatch async
      // (below) and record a running attempt so the resolver WAITs cleanly.
      const specFile = await readSpecFileAsync(projectId);
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      const d = pRow?.details ? validateDetails(pRow.details) : null;
      const repos = d?.repos ?? [];
      if (repos.length === 0) break;
      const repoList = repos.map((r) => `- ${r.name} (${r.pathOnDisk})`).join('\n');
      const { PLAN_AUTHOR_SYSTEM_PROMPT } = await import('@/build/plan-author');
      const planPath = planFilePath(projectId);
      const prompt = PLAN_AUTHOR_SYSTEM_PROMPT.replace('PLAN_FILE_PATH', planPath)
        + `\n\n# Target repositories\n\n${repoList}`
        + `\n\n# Locked Specification\n\n${specFile?.bodyMd ?? '(no spec)'}`;
      // Async (no `await`): plan authoring can take many minutes. Blocking the
      // driver risks the 15-min sync wait-timeout marking the row `failed` while
      // the LLM task is still alive — which used to re-fire a fresh author every
      // retry. PollManager owns the poll loop, fires the terminal handler, and
      // rehydrates on boot, so async is both correct and non-blocking.
      const { batchRowId } = await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'plan-author', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID,
      });
      // Record the running attempt so the resolver returns WAIT (not re-dispatch)
      // until the plan-author handler closes it out and sets refine.file.
      await updateDetails(db, projectId, (det) => recordAuthorAttempt(det, batchRowId, new Date().toISOString()));
      break;
    }

    case 'validate_task': {
      const taskId = action.data?.taskId as string;
      const taskTitle = action.data?.taskTitle as string;
      if (!taskId) break;
      const [seqRow] = await db
        .select({ max: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
        .from(qaMessage)
        .where(eq(qaMessage.targetId, taskId));
      await db.insert(qaMessage).values({
        targetId: taskId, projectId, targetKind: 'plan_task',
        seq: (seqRow?.max ?? -1) + 1,
        bodyMd: 'Review this task for completeness, accuracy, and test coverage. Flag any gaps. @Forge',
        authorId: FORGE_MEMBER_ID,
      });
      const { batchRowId } = await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'plan-refine', cwd,
        body: { prompt: `Review the plan task "${taskTitle}" for completeness, accuracy, and test coverage. Flag any gaps.`, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, meta: { taskId }, await: true,
      });
      const [seqRow2] = await db
        .select({ max: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
        .from(qaMessage)
        .where(eq(qaMessage.targetId, taskId));
      await db.insert(qaMessage).values({
        targetId: taskId, projectId, targetKind: 'plan_task',
        seq: (seqRow2?.max ?? -1) + 1,
        authorId: FORGE_MEMBER_ID,
        bodyMd: 'Task reviewed — no critical issues found.',
      });
      // Record the validation attempt so the resolver advances to approve_task
      // instead of re-validating this same task forever.
      await updateDetails(db, projectId, (d) => recordTaskValidation(d, taskId, batchRowId, new Date().toISOString()));
      break;
    }

    case 'approve_task': {
      const taskId = action.data?.taskId as string;
      if (!taskId) break;
      await updateDetails(db, projectId, (d) => {
        const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === taskId);
        if (task && !task.approvals.includes(FORGE_MEMBER_ID)) {
          task.approvals.push(FORGE_MEMBER_ID);
          task.status = 'approved';
        }
        return d;
      });
      projectEventBus.publish(projectId, {
        type: 'plan.updated', taskId, chatReply: 'Forge approved this task.', updated: true,
      });
      break;
    }

    case 'dispatch_execute': {
      // Identical to the manual "Run execution" button — the SAME shared core sets
      // up the project branch (forge/<project> off origin/<default>), dispatches
      // execute_plan ASYNC on it, and the handler pushes + opens the PR. The
      // in-flight guard makes the driver WAIT while it runs; the execute-pipeline
      // handler records the implement attempt on terminal so the resolver advances.
      const repoList = action.data?.repos as Array<{ repoId: string; targetBranch: string }> | undefined;
      await startExecuteRun(db, mma, projectId, FORGE_MEMBER_ID, repoList);
      break;
    }

    case 'dispatch_review': {
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      // A re-review targets ONE repo (resolver passes its repoId); the initial review
      // (no repoId) fans out to every repo. The code-review handler records the pass
      // into details.reviewPasses (single writer for manual + auto) — no re-review
      // loop, and manual↔auto switching is safe.
      const targetRepoId = action.data?.repoId as string | undefined;
      const reviewRepos = targetRepoId ? d.repos.filter((r) => r.id === targetRepoId) : d.repos;
      for (const r of reviewRepos) {
        const repoEntry = d.stages.review.phases.review.repos.find((x) => x.repoId === r.id);
        const prevBlockId = lastReadBlockId(repoEntry?.reviewPasses[repoEntry.reviewPasses.length - 1]?.review?.attempts);
        await dispatchMma({
          db, mma, projectId, route: 'review', handler: 'code-review', cwd: r.pathOnDisk,
          body: { target: { paths: ['.'] }, prompt: 'Review all changed files.', ...(prevBlockId ? { contextBlockIds: [prevBlockId] } : {}) },
          actorId: FORGE_MEMBER_ID, meta: { repoId: r.id }, await: true,
        });
      }
      break;
    }

    case 'apply_review_findings': {
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      // Target the specific repo the resolver flagged (multi-repo safe); fall back to
      // the sole repo for the single-repo / manual path.
      const targetRepoId = action.data?.repoId as string | undefined;
      const entry = (targetRepoId && d.stages.review.phases.review.repos.find((r) => r.repoId === targetRepoId))
        ?? d.stages.review.phases.review.repos[0];
      if (!entry) break;
      const repoMeta = d.repos.find((r) => r.id === entry.repoId);
      if (!repoMeta) break;
      // Resolve the pass's findings so we can (a) enumerate exactly the chosen subset in
      // the fix prompt and (b) record which indices were applied (drives the per-pass
      // applied UI). Manual sends `findingIndices`; auto sends none → apply ALL. Same
      // dispatch either way — only the array size differs.
      const lastPass = entry.reviewPasses[entry.reviewPasses.length - 1];
      const passNo = (action.data?.passNo as number | undefined) ?? lastPass?.passNo;
      const reviewBatchId = lastPass?.review?.attempts?.[0]?.batchId;
      let allFindings: RawReviewFinding[] = [];
      if (reviewBatchId) {
        const [rb] = await db.select({ result: mmaBatch.result }).from(mmaBatch).where(eq(mmaBatch.id, reviewBatchId)).limit(1);
        if (rb?.result) allFindings = extractReviewFindings(rb.result);
      }
      const selRaw = (action.data as { findingIndices?: unknown } | undefined)?.findingIndices;
      const selected = Array.isArray(selRaw)
        ? selRaw.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < allFindings.length)
        : [];
      const indices = selected.length > 0 ? selected : allFindings.map((_, i) => i);
      const chosen = indices.map((i) => allFindings[i]).filter(Boolean);
      const prompt = chosen.length > 0
        ? buildReviewFixPrompt(chosen)
        : 'Apply the code-review findings from the previous review pass to the code in this repository. Make the fixes directly.';
      // `delegate` (worktree route): MMA cuts a worktree off the checked-out
      // `forge/…` branch HEAD, the worker applies the fixes, and MMA force-commits
      // the diff and fast-forward-merges it back onto the project branch — so MMA
      // OWNS the commit (no Forge-side git add/commit). `reviewPolicy:'none'` keeps
      // it a single-worker single-commit run. The worker runs in an isolated HEAD
      // checkout, so the working tree MUST be clean at dispatch (execute + prior
      // review-apply both commit, so it is). The handler records the fix + pushes.
      // `passNo` + `findingIndices` ride in meta → the batch request column → the review
      // page reads them back to show which findings are applied.
      await dispatchMma({
        db, mma, projectId, route: 'delegate', handler: 'review-apply', cwd: repoMeta.pathOnDisk,
        body: { prompt, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, meta: { repoId: entry.repoId, passNo, findingIndices: indices }, await: true,
      });
      break;
    }

    case 'dispatch_harvest': {
      const { buildHarvestPrompt } = await import('@/journal/harvest-prompt');
      const prompt = await buildHarvestPrompt(projectId, db);
      const { batchRowId } = await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'journal-harvest', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, await: true,
      });
      // Record the harvest attempt so the resolver moves on to approving learnings
      // instead of re-harvesting (the handler already pushed the learnings).
      await updateDetails(db, projectId, (det) => recordHarvestAttempt(det, batchRowId, new Date().toISOString()));
      break;
    }

    case 'approve_learning': {
      const idx = action.data?.learningIndex as number;
      await updateDetails(db, projectId, (d) => {
        if (d.stages.journal.phases.journal.learnings[idx]) {
          d.stages.journal.phases.journal.learnings[idx].status = 'kept';
        }
        return d;
      });
      break;
    }

    case 'dispatch_record': {
      const { buildRecordPrompt } = await import('@/journal/record-prompt');
      const prompt = await buildRecordPrompt(projectId, db);
      await dispatchMma({
        db, mma, projectId, route: 'journal_record', handler: 'journal-record', cwd,
        body: { prompt },
        actorId: FORGE_MEMBER_ID, await: true,
      });
      break;
    }

    case 'mark_complete': {
      const now = new Date();
      await updateDetails(db, projectId, (d) => {
        for (const stg of Object.values(d.stages)) {
          if (stg.status !== 'done') {
            stg.status = 'done';
            if (!stg.completedAt) stg.completedAt = now.toISOString();
          }
        }
        d.automation.status = 'off';
        d.automation.stoppedAt = now.toISOString();
        return d;
      });
      await db.update(project).set({ completedAt: now, updatedAt: now }).where(eq(project.id, projectId));
      break;
    }

    // ── Design-phase (manual-only) effects — Task 8b-1. The ONE implementation of
    //    each explore step, ported from the retired explore/{propose,run,synthesize}
    //    routes. Async dispatch (no await:true): the PollManager records the terminal.
    case 'propose_discover_tasks': {
      const { buildProposeRequest } = await import('@/exploration/fan-out');
      const request = await buildProposeRequest(projectId, { db });
      const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      const repoIds = projRow?.details ? validateDetails(projRow.details).repos.map((r) => r.id) : [];
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'explore-propose', cwd,
        body: { prompt: `${request.system}\n\n${request.user}`, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, meta: { actorId: FORGE_MEMBER_ID, repoIds },
      });
      break;
    }

    case 'run_discover_tasks': {
      const { dispatchTasks } = await import('@/exploration/dispatch');
      const { getSynthesisScheduler } = await import('@/exploration/synthesis-scheduler');
      getSynthesisScheduler().watch(projectId);
      // NOTE: dispatchTasks dispatches ALL `draft` discover tasks (the per-id subset
      // was never honored); `run_discover_tasks` is an all-drafts fan-out.
      await dispatchTasks(projectId, { id: FORGE_MEMBER_ID }, { db });
      break;
    }

    case 'dispatch_synthesize': {
      const { buildSynthesizeRequest } = await import('@/exploration/synthesize');
      const request = await buildSynthesizeRequest(projectId, { db });
      if ('error' in request) break; // nothing to synthesize yet
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'explore-synthesize', cwd,
        body: { prompt: `${request.system}\n\n${request.user}`, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, meta: { actorId: FORGE_MEMBER_ID },
      });
      break;
    }

    // ── Spec-craft approval (Task 8b-2). ONE implementation, ported from
    //    spec/sections/[sectionId]/nod (onHumanSatisfied).
    case 'approve_component': {
      const componentId = action.data?.componentId as string | undefined;
      if (!componentId) break;
      const actorId = (action.data?.actorId as string) ?? FORGE_MEMBER_ID;
      const { onHumanSatisfied } = await import('@/spec/orchestrator');
      await onHumanSatisfied({ db }, projectId, componentId, actorId);
      break;
    }

    // ── Content edits (Task 10) — skip the phase lease (spec §4.5). The ONE
    //    implementation each, from explore/brief (saveBrief) and the spec outline
    //    confirm (confirmComponents).
    case 'set_brief': {
      const text = action.data?.text as string | undefined;
      if (text == null) break;
      const actorId = (action.data?.actorId as string) ?? FORGE_MEMBER_ID;
      const { saveBrief } = await import('@/exploration/explore-core');
      await saveBrief(projectId, text, { id: actorId });
      await db.update(project).set({ intentMd: text, updatedAt: new Date() }).where(eq(project.id, projectId));
      break;
    }

    case 'select_components': {
      const kinds = action.data?.kinds as string[] | undefined;
      if (!kinds || kinds.length === 0) break;
      const actorId = (action.data?.actorId as string) ?? FORGE_MEMBER_ID;
      const intentMd = action.data?.intentMd as string | undefined;
      // Outline confirm: capture intent (derive summary) THEN create the selected
      // components + their sections — the single implementation, ported whole from
      // the spec/confirm route (which did captureIntent + confirmComponents).
      const { captureIntent, ensureSpecStage } = await import('@/spec/spec-core');
      const { confirmComponents } = await import('@/spec/orchestrator');
      await ensureSpecStage(db, projectId);
      if (intentMd) await captureIntent(db, projectId, intentMd, actorId);
      await confirmComponents(db, projectId, kinds as never);
      break;
    }

    // ── refine_component: the ONE spec-refine dispatch, ported from
    //    spec/components/[componentId]/refine (buildRefinePrompt over the component
    //    draft + message delta). Per-target (meta.componentId), skips the phase lease.
    case 'refine_component': {
      const componentId = action.data?.componentId as string | undefined;
      if (!componentId) break;
      const actorId = (action.data?.actorId as string) ?? FORGE_MEMBER_ID;
      const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!projRow?.details) break;
      const d = validateDetails(projRow.details);
      const detailsComp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
      if (!detailsComp) break;
      const { teamSpecTemplate } = await import('@/db/schema/team');
      const [tpl] = await db.select().from(teamSpecTemplate).where(eq(teamSpecTemplate.id, detailsComp.templateId)).limit(1);
      if (!tpl) break;
      const sections = Array.isArray(tpl.sections) ? (tpl.sections as Array<{ key: string; label: string }>) : [];
      const sectionLabels = sections.map((s) => s.label);
      const { readComponentSections } = await import('@/spec/spec-file-ops');
      const fileSections = await readComponentSections(projectId, sectionLabels);
      const componentDraftMd = fileSections.map((s) => `${s.heading}\n\n${s.body}`).join('\n\n');
      const rawMessages = await db.select({ authorId: qaMessage.authorId, bodyMd: qaMessage.bodyMd }).from(qaMessage).where(eq(qaMessage.targetId, componentId)).orderBy(asc(qaMessage.seq));
      const allMessages = rawMessages.map((m) => ({ sender: (m.authorId === FORGE_MEMBER_ID ? 'forge' : 'member') as 'forge' | 'member', bodyMd: m.bodyMd }));
      const { getMessagesSinceLastForge, buildRefinePrompt } = await import('@/spec/refine-prompt');
      const isFirstCall = !allMessages.some((m) => m.sender === 'forge');
      const delta = getMessagesSinceLastForge(allMessages);
      let fullSpecMd: string | undefined;
      if (isFirstCall) {
        const { getLatestSpec } = await import('@/spec/assemble');
        const spec = await getLatestSpec(db, projectId);
        fullSpecMd = spec?.bodyMd;
      }
      const { system, user } = buildRefinePrompt({ componentLabel: tpl.label, sectionHeadings: sectionLabels, componentDraftMd, messagesSinceLastForge: delta, isFirstCall, fullSpecMd });
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'spec-refine', cwd,
        body: { prompt: `${system}\n\n${user}`, reviewPolicy: 'none' },
        actorId, meta: { componentId },
      });
      break;
    }

    // ── Cross-cutting: the auto toggle (Task 8b-3). ONE implementation, replacing the
    //    retired automation/{start,stop} routes.
    case 'start_auto': {
      await setAutomationStatus(db, projectId, 'running');
      await db.update(project).set({ autoMode: true, autoNote: 'Starting automation...', updatedAt: new Date() }).where(eq(project.id, projectId));
      // Launch the driver loop (dynamic import breaks the driver→performTransition→
      // details-actions static cycle). Fire-and-forget; it acquires its own lease.
      const { driveProject } = await import('@/automation/driver');
      driveProject(projectId).catch(() => {});
      break;
    }

    case 'take_over': {
      await setAutomationStatus(db, projectId, 'off');
      await db.update(project).set({ autoMode: false, updatedAt: new Date() }).where(eq(project.id, projectId));
      // Force-clear the driver's lease so a stuck holder can't block manual work; the
      // running driver's heartbeat then reports the loss and it stops at its next check.
      const [pr] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      const driverId = pr?.details ? validateDetails(pr.details).automation.driverId : undefined;
      if (driverId) await releaseDriverLease(db, projectId, driverId).catch(() => {});
      break;
    }

    default:
      break;
  }
  return 'ok';
}

function buildRevisePrompt(filePath: string, findings: Array<{ severity: string; category: string; claim: string; evidence?: string; suggestion?: string }>): string {
  const block = findings.map((f, i) => {
    let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.claim}`;
    if (f.evidence) line += `\n   Evidence: ${f.evidence}`;
    if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
    return line;
  }).join('\n\n');
  return `Role: You are a specification reviser.\n\nTask: Read the file at \`${filePath}\`, apply every finding below, write the revised file back to the SAME file.\n\nFindings:\n\n${block}`;
}
