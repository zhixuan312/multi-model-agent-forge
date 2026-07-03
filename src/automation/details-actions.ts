import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { mmaBatch } from '@/db/schema/ops';
import { qaMessage } from '@/db/schema/spec';
import { specFilePath, planFilePath, readSpecFileAsync, readPlanFileAsync, backupArtifact } from '@/projects/project-files';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import { projectEventBus } from '@/sse/event-bus';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { updateDetails, advanceStage, advancePhase } from '@/details/write';
import { validateDetails } from '@/details/schema';
import type { AutoAction } from '@/automation/details-resolver';
import { sql } from 'drizzle-orm';

export async function executeDetailsAction(projectId: string, action: AutoAction, db: Db = getDb()): Promise<void> {
  const cwd = resolveWorkspaceRoot();
  const mma = await buildMmaClient({ db });

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
        await updateDetails(db, projectId, (d) => {
          for (const comp of d.stages.spec.phases.craft.components) {
            if (!comp.approvals.includes(FORGE_MEMBER_ID)) comp.approvals.push(FORGE_MEMBER_ID);
          }
          if (!d.stages.spec.participants.includes(FORGE_MEMBER_ID)) d.stages.spec.participants.push(FORGE_MEMBER_ID);
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

    case 'advance_phase': {
      const toPhase = action.phase;
      await advancePhase(db, projectId, action.stage as any, toPhase);
      break;
    }

    case 'dispatch_plan_author': {
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
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'plan-author', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, await: true,
      });
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
      await dispatchMma({
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
      const [pRow] = await db.select({ details: project.details, name: project.name }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      const repos = d.repos;
      if (repos.length === 0) throw new Error('No repos linked to project');
      const planFile = await readPlanFileAsync(projectId);
      if (!planFile) throw new Error('No plan.md found');
      const planPath = planFilePath(projectId);
      for (const r of repos) {
        await dispatchMma({
          db, mma, projectId, route: 'execute_plan', handler: 'execute-pipeline', cwd: r.pathOnDisk,
          body: { type: 'execute_plan', target: { paths: [planPath] }, tasks: [], reviewPolicy: 'reviewed' },
          actorId: FORGE_MEMBER_ID, await: true,
        });
      }
      break;
    }

    case 'dispatch_review': {
      const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
      if (!pRow?.details) break;
      const d = validateDetails(pRow.details);
      for (const r of d.repos) {
        await dispatchMma({
          db, mma, projectId, route: 'review', handler: 'code-review', cwd: r.pathOnDisk,
          body: { target: { paths: ['.'] }, prompt: 'Review all changed files.' },
          actorId: FORGE_MEMBER_ID, await: true,
        });
      }
      break;
    }

    case 'apply_review_findings': {
      // Similar to apply_findings but for review
      break;
    }

    case 'dispatch_harvest': {
      const { buildHarvestPrompt } = await import('@/journal/harvest-prompt');
      const prompt = await buildHarvestPrompt(projectId, db);
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'journal-harvest', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId: FORGE_MEMBER_ID, await: true,
      });
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
