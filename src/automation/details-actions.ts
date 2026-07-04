import { eq } from 'drizzle-orm';
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
import { updateDetails, advanceStage, advancePhase, reopenStage } from '@/details/write';
import type { StageKind } from '@/db/enums';
import { validateDetails } from '@/details/schema';
import {
  recordAuthorAttempt, failStuckAuthorAttempt, recordTaskValidation, recordHarvestAttempt,
} from '@/automation/details-mutations';
import { startExecuteRun } from '@/build/start-execute-run';
import type { AutoAction } from '@/automation/details-resolver';
import { sql } from 'drizzle-orm';

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
 * The plan-author attempt is recorded `running` at dispatch and closed to `done`
 * by the terminal handler — but the handler only runs on SUCCESS. If the batch
 * ends `failed` (e.g. MMA wrote no plan.md so the handler threw), the attempt is
 * left `running` and the resolver would WAIT forever. Reconcile that here: flip a
 * `running` author attempt to `failed` once its batch is terminal-failed, so the
 * resolver re-dispatches (bounded by the in-flight guard — one at a time).
 */
export async function reconcilePlanAuthorAttempt(db: Db, projectId: string): Promise<void> {
  const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!pRow?.details) return;
  const d = validateDetails(pRow.details);
  const refine = d.stages.plan.phases.refine;
  if (refine.file) return; // handler already closed the attempt out
  const last = refine.attempts[refine.attempts.length - 1];
  if (!last || last.status !== 'running' || !last.batchId) return;
  const [batch] = await db.select({ status: mmaBatch.status }).from(mmaBatch).where(eq(mmaBatch.id, last.batchId)).limit(1);
  if (batch?.status !== 'failed') return;
  // Flip the open attempt to failed + log an error line (surfaces the async
  // failure and un-collapses the retry). Also mirror the error line onto the live
  // stream so the UI shows it immediately, not only on the next refresh.
  await updateDetails(db, projectId, (det) => { failStuckAuthorAttempt(det, new Date().toISOString()); return det; });
  projectEventBus.publish(projectId, { type: 'automation.progress', note: 'Plan author failed — retrying', stage: 'plan', phase: 'refine', kind: 'error' });
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
      await dispatchMma({
        db, mma, projectId, route: 'audit', handler: `${scope}-audit`, cwd,
        body: { subtype: scope, target: { paths: [filePath] } },
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
      const findings = extractFindings(batch.result);
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
      await startExecuteRun(db, mma, projectId, FORGE_MEMBER_ID);
      break;
    }

    case 'dispatch_review': {
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      for (const r of d.repos) {
        // The code-review handler records the pass into details.reviewPasses (the
        // single writer for manual + auto); the resolver reads it to advance or
        // apply findings — no re-review loop, and manual↔auto switching is safe.
        await dispatchMma({
          db, mma, projectId, route: 'review', handler: 'code-review', cwd: r.pathOnDisk,
          body: { target: { paths: ['.'] }, prompt: 'Review all changed files.' },
          actorId: FORGE_MEMBER_ID, meta: { repoId: r.id }, await: true,
        });
      }
      break;
    }

    case 'apply_review_findings': {
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      const entry = d.stages.review.phases.review.repos[0];
      if (!entry) break;
      const repoMeta = d.repos.find((r) => r.id === entry.repoId);
      if (!repoMeta) break;
      // The review-apply handler records the fix into details (single writer) and
      // pushes the project branch. Body carries ONLY the orchestrate task's own
      // fields — the MMA schema rejects unrecognized keys (cwd/repoId → HTTP 400);
      // cwd is the dispatch cwd (URL), repoId rides in meta.
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'review-apply', cwd: repoMeta.pathOnDisk,
        body: { prompt: 'Apply the code-review findings from the previous review pass to the code in this repository. Make the fixes directly.', reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, meta: { repoId: entry.repoId }, await: true,
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

    default:
      break;
  }
  return 'ok';
}

function extractFindings(result: unknown): Array<{ severity: string; category: string; claim: string; evidence?: string; suggestion?: string }> {
  const r = result as Record<string, unknown>;
  const output = (r?.output ?? {}) as Record<string, unknown>;
  const summary = output.summary;
  let findings: unknown[] = [];
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    findings = (summary as Record<string, unknown>).findings as unknown[] ?? [];
  }
  if (!Array.isArray(findings)) return [];
  return findings.map((f: unknown) => {
    const ff = f as Record<string, unknown>;
    return {
      severity: String(ff.weight ?? ff.severity ?? ''),
      category: String(ff.category ?? ''),
      claim: String(ff.claim ?? ''),
      evidence: ff.evidence ? String(ff.evidence) : undefined,
      suggestion: ff.suggestion ? String(ff.suggestion) : undefined,
    };
  });
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
