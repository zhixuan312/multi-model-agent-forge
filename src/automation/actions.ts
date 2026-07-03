import { eq, and, ne, asc } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { getDb, type Db } from '@/db/client';
import { project, stage, projectRepo } from '@/db/schema/projects';
import { planTask } from '@/db/schema/build';
import { learningCandidate } from '@/db/schema/learning';
import { auditPass } from '@/db/schema/artifacts';
import { participant } from '@/db/schema/participants';
import { mmaBatch } from '@/db/schema/ops';
import { repo } from '@/db/schema/workspace';
import { specFilePath, planFilePath, readSpecFileAsync, readPlanFileAsync, backupArtifact } from '@/projects/project-files';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import { advancePhase } from '@/projects/phase-tracker';
import { projectEventBus } from '@/sse/event-bus';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import type { AutoAction } from '@/automation/resolver';

export async function executeAction(projectId: string, action: AutoAction, db: Db = getDb()): Promise<void> {
  const cwd = resolveWorkspaceRoot();
  const mma = await buildMmaClient({ db });
  const actorId = FORGE_MEMBER_ID;

  switch (action.kind) {
    // ── Spec ──────────────────────────────────────────────────────────
    case 'dispatch_spec_audit': {
      // Matches: app/(app)/projects/[id]/spec/audit/route.ts
      const latestPass = await db.select({ contextBlockId: auditPass.contextBlockId })
        .from(auditPass)
        .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec')))
        .orderBy(asc(auditPass.passNo))
        .then((rows) => rows[rows.length - 1]);
      await dispatchMma({
        db, mma, projectId, route: 'audit', handler: 'spec-audit', cwd,
        body: {
          subtype: 'spec',
          target: { paths: [specFilePath(projectId)] },
          ...(latestPass?.contextBlockId ? { contextBlockIds: [latestPass.contextBlockId] } : {}),
        },
        actorId, await: true,
      });
      break;
    }

    case 'apply_spec_findings': {
      // Matches: app/(app)/projects/[id]/spec/audit-apply/route.ts
      const passNo = (action.data?.passNo as number) ?? 1;
      const findings = await extractAuditFindings(db, projectId, 'spec', passNo);
      if (findings.length === 0) break;
      await backupArtifact(projectId, 'spec.md');
      const prompt = buildRevisePrompt(specFilePath(projectId), findings);
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'spec-audit-apply', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId,
        meta: { passNo, findingsCount: findings.length },
        await: true,
      });
      break;
    }

    case 'freeze_spec': {
      // Approve all components + set stage approver + advance
      const { component } = await import('@/db/schema/spec');
      const [specStage] = await db.select({ id: stage.id }).from(stage)
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec'))).limit(1);
      if (specStage) {
        const comps = await db.select({ id: component.id }).from(component)
          .where(eq(component.stageId, specStage.id));
        for (const c of comps) {
          await db.insert(participant).values({
            projectId, memberId: actorId, scope: 'component', scopeId: c.id, role: 'approver',
          }).onConflictDoNothing();
          await db.update(component).set({ status: 'approved' }).where(eq(component.id, c.id));
        }
        await db.insert(participant).values({
          projectId, memberId: actorId, scope: 'stage', scopeId: specStage.id, role: 'approver',
        }).onConflictDoNothing();
      }
      await advancePhase(db, projectId, 'spec', 'finalize');
      const now = new Date();
      await db.update(stage).set({ status: 'done', completedAt: now })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')));
      await db.update(project).set({ phase: 'build', updatedAt: now })
        .where(eq(project.id, projectId));
      break;
    }

    // ── Plan ──────────────────────────────────────────────────────────
    case 'dispatch_plan_author': {
      // Matches: app/(app)/projects/[id]/build/author-plan/route.ts
      const specFile = await readSpecFileAsync(projectId);
      const repos = await db.select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk })
        .from(projectRepo).innerJoin(repo, eq(projectRepo.repoId, repo.id))
        .where(eq(projectRepo.projectId, projectId));
      const repoList = repos.map((r) => `- ${r.name} (${r.pathOnDisk})`).join('\n');
      const { PLAN_AUTHOR_SYSTEM_PROMPT } = await import('@/build/plan-author');
      const planPath = planFilePath(projectId);
      const prompt = PLAN_AUTHOR_SYSTEM_PROMPT.replace('PLAN_FILE_PATH', planPath)
        + `\n\n# Target repositories\n\n${repoList}`
        + `\n\n# Locked Specification\n\n${specFile?.bodyMd ?? '(no spec)'}`;
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'plan-author', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId,
        meta: { actorId, cwd },
        await: true,
      });
      break;
    }

    case 'validate_task': {
      // Send a self-validation message as forge user, then dispatch @Forge refine
      const taskId = action.data?.taskId as string;
      const taskTitle = action.data?.taskTitle as string;
      if (!taskId) break;

      // 1. Insert user message (validation request)
      const { qaMessage } = await import('@/db/schema/spec');
      const { sql } = await import('drizzle-orm');
      const [seqRow] = await db
        .select({ max: sql<number>`coalesce(max(${qaMessage.seq}), -1)` })
        .from(qaMessage)
        .where(eq(qaMessage.componentId, taskId));
      const seq = (seqRow?.max ?? -1) + 1;
      const validationMsg = 'Review this task for completeness, accuracy, and test coverage. Flag any gaps. @Forge';
      await db.insert(qaMessage).values({
        componentId: taskId,
        seq,
        sender: 'member',
        bodyMd: validationMsg,
        authorId: actorId,
      });

      // 2. Dispatch plan-refine (same as clicking @Forge)
      await dispatchMma({
        db, mma, projectId,
        route: 'orchestrate',
        handler: 'plan-refine',
        cwd,
        body: {
          prompt: `Review the plan task "${taskTitle}" for completeness, accuracy, and test coverage. Flag any gaps.`,
          reviewPolicy: 'none',
        },
        actorId,
        meta: { taskId },
        await: true,
      });
      break;
    }

    case 'approve_task': {
      // Matches: app/(app)/projects/[id]/plan/tasks/[taskId]/approve/route.ts
      const taskId = action.data?.taskId as string;
      if (!taskId) break;
      await db.insert(participant).values({
        projectId, memberId: actorId, scope: 'task', scopeId: taskId, role: 'approver',
      }).onConflictDoNothing();
      await db.insert(participant).values({
        projectId, memberId: actorId, scope: 'task', scopeId: taskId, role: 'reviewer',
      }).onConflictDoNothing();
      await db.update(planTask).set({ status: 'committed', updatedAt: new Date() })
        .where(eq(planTask.id, taskId));
      projectEventBus.publish(projectId, {
        type: 'plan.updated', taskId, chatReply: 'Forge approved this task.', updated: true,
      });
      break;
    }

    case 'advance_plan_validate': {
      await advancePhase(db, projectId, 'plan', 'validate');
      break;
    }

    case 'dispatch_plan_audit': {
      // Matches: app/(app)/projects/[id]/build/run-audit/route.ts
      const tasks = await db.select({ targetRepoId: planTask.targetRepoId })
        .from(planTask).where(eq(planTask.projectId, projectId)).limit(1);
      let auditCwd = cwd;
      if (tasks[0]?.targetRepoId) {
        const [r] = await db.select({ pathOnDisk: repo.pathOnDisk })
          .from(repo).where(eq(repo.id, tasks[0].targetRepoId)).limit(1);
        if (r) auditCwd = r.pathOnDisk;
      }
      await dispatchMma({
        db, mma, projectId, route: 'audit', handler: 'plan-audit', cwd: auditCwd,
        body: { subtype: 'plan', target: { paths: [planFilePath(projectId)] } },
        actorId, await: true,
      });
      break;
    }

    case 'apply_plan_findings': {
      // Matches: app/(app)/projects/[id]/plan/audit-apply/route.ts
      const passNo = (action.data?.passNo as number) ?? 1;
      const findings = await extractAuditFindings(db, projectId, 'plan', passNo);
      if (findings.length === 0) break;
      await backupArtifact(projectId, 'plan.md');
      const prompt = buildRevisePrompt(planFilePath(projectId), findings);
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'plan-audit-apply', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId,
        meta: { passNo, findingsCount: findings.length },
        await: true,
      });
      break;
    }

    case 'lock_plan': {
      await advancePhase(db, projectId, 'plan', 'validate');
      const now = new Date();
      await db.update(stage).set({ status: 'done', completedAt: now })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'plan')));
      await db.update(project).set({ updatedAt: now }).where(eq(project.id, projectId));
      break;
    }

    // ── Execute ──────────────────────────────────────────────────────
    case 'dispatch_execute': {
      // Matches: app/api/projects/[id]/build/start-execute/route.ts
      const repos = await db.select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
        .from(projectRepo).innerJoin(repo, eq(projectRepo.repoId, repo.id))
        .where(eq(projectRepo.projectId, projectId));
      if (repos.length === 0) throw new Error('No repos linked to project');

      const planFile = await readPlanFileAsync(projectId);
      if (!planFile) throw new Error('No plan.md found');
      const planPath = planFilePath(projectId);

      const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, projectId));
      const { projectShortId } = await import('@/build/slug');
      const { buildForgeBranch } = await import('@/build/execute-core');
      const shortId = projectShortId(projectId);
      const forgeBranch = buildForgeBranch(proj?.name ?? projectId, shortId);

      for (const r of repos) {
        const targetBranch = r.defaultBranch ?? 'main';
        // Git: create or checkout forge branch
        try {
          const branchExists = execFileSync('git', ['-C', r.pathOnDisk, 'branch', '--list', forgeBranch], { encoding: 'utf8' }).trim();
          if (branchExists) {
            execFileSync('git', ['-C', r.pathOnDisk, 'checkout', forgeBranch]);
          } else {
            execFileSync('git', ['-C', r.pathOnDisk, 'fetch', 'origin', targetBranch], { timeout: 30_000 });
            execFileSync('git', ['-C', r.pathOnDisk, 'checkout', '-b', forgeBranch, `origin/${targetBranch}`]);
          }
        } catch (err) {
          throw new Error(`Branch prep failed: ${(err as Error).message}`);
        }

        const taskTitles = (await db.select({ title: planTask.title }).from(planTask)
          .where(eq(planTask.projectId, projectId))).map((t) => t.title);

        await dispatchMma({
          db, mma, projectId, route: 'execute_plan', handler: 'execute-pipeline', cwd: r.pathOnDisk,
          body: { type: 'execute_plan', target: { paths: [planPath] }, tasks: [], reviewPolicy: 'reviewed' },
          actorId,
          meta: { forgeBranch, targetBranch, repoId: r.id, actorId, tasks: taskTitles },
          await: true,
        });

        await db.update(planTask)
          .set({ targetRepoId: r.id, status: 'executing', targetBranch, branch: forgeBranch, updatedAt: new Date() })
          .where(eq(planTask.projectId, projectId));
      }
      break;
    }

    // ── Stage transitions ────────────────────────────────────────────
    case 'advance_to_review': {
      const now = new Date();
      await db.update(stage).set({ status: 'done', completedAt: now })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'execute')));
      break;
    }

    // ── Review ───────────────────────────────────────────────────────
    case 'dispatch_review': {
      // Matches: app/api/projects/[id]/review/run/route.ts
      const repos = await db.select({ id: repo.id, pathOnDisk: repo.pathOnDisk })
        .from(projectRepo).innerJoin(repo, eq(projectRepo.repoId, repo.id))
        .where(eq(projectRepo.projectId, projectId));
      for (const r of repos) {
        // Get changed files from latest execute batch
        const [execBatch] = await db.select({ result: mmaBatch.result })
          .from(mmaBatch)
          .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.route, 'execute_plan'), eq(mmaBatch.status, 'done')))
          .orderBy(asc(mmaBatch.createdAt))
          .then((rows) => rows.slice(-1));
        const changedFiles = (execBatch?.result as any)?.output?.filesChanged ?? [];
        await dispatchMma({
          db, mma, projectId, route: 'review', handler: 'code-review', cwd: r.pathOnDisk,
          body: {
            target: { paths: changedFiles.length > 0 ? changedFiles : ['.'] },
            prompt: 'Review all changed files for correctness, security, performance, cross-file ripple, test gaps, and style issues.',
          },
          actorId,
          meta: { repoId: r.id },
          await: true,
        });
      }
      break;
    }

    case 'apply_review_findings': {
      // Matches: app/api/projects/[id]/review/apply/route.ts
      const passNo = (action.data?.passNo as number) ?? 1;
      const reviewBatches = await db.select({ id: mmaBatch.id, result: mmaBatch.result, cwd: mmaBatch.cwd, targetRepoId: mmaBatch.targetRepoId })
        .from(mmaBatch)
        .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'done')))
        .orderBy(asc(mmaBatch.createdAt));
      const passBatch = reviewBatches[passNo - 1];
      if (!passBatch) break;
      const findings = extractReviewFindings(passBatch.result);
      if (findings.length === 0) break;
      const allIndices = findings.map((_, i) => i);
      const prompt = buildReviewFixPrompt(findings);
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'review-apply',
        cwd: passBatch.cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId,
        meta: { passNo, findingIndices: allIndices, findingsCount: findings.length, repoId: passBatch.targetRepoId, cwd: passBatch.cwd },
        await: true,
      });
      break;
    }

    case 'advance_to_journal': {
      const now = new Date();
      await db.update(stage).set({ status: 'done', completedAt: now })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'review')));
      break;
    }

    // ── Journal ──────────────────────────────────────────────────────
    case 'dispatch_harvest': {
      // Matches: app/api/projects/[id]/journal/harvest/route.ts
      // The harvest route builds a massive prompt from all project artifacts.
      // We call the same route logic by importing its prompt builder.
      const { buildHarvestPrompt } = await import('@/journal/harvest-prompt');
      const prompt = await buildHarvestPrompt(projectId, db);
      await dispatchMma({
        db, mma, projectId, route: 'orchestrate', handler: 'journal-harvest', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId,
        await: true,
      });
      break;
    }

    case 'approve_learning': {
      // Matches: app/api/projects/[id]/journal/approve/route.ts
      const learningId = action.data?.learningId as string;
      if (!learningId) break;
      await db.update(learningCandidate).set({ status: 'kept' })
        .where(eq(learningCandidate.id, learningId));
      break;
    }

    case 'dispatch_record': {
      // Matches: app/api/projects/[id]/journal/record/route.ts
      const { buildRecordPrompt } = await import('@/journal/record-prompt');
      const prompt = await buildRecordPrompt(projectId, db);
      const kept = await db.select({ id: learningCandidate.id })
        .from(learningCandidate)
        .where(and(eq(learningCandidate.projectId, projectId), eq(learningCandidate.status, 'kept')));
      await dispatchMma({
        db, mma, projectId, route: 'journal_record', handler: 'journal-record', cwd,
        body: { prompt },
        actorId,
        meta: { learningIds: kept.map((l) => l.id), learningCount: kept.length },
        await: true,
      });
      break;
    }

    // ── Navigation (change page + update currentStage) ─────────────
    case 'navigate_to_plan': {
      await db.update(project).set({ currentStage: 'plan', updatedAt: new Date() }).where(eq(project.id, projectId));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'plan'), eq(stage.status, 'pending')));
      projectEventBus.publish(projectId, { type: 'automation.navigate', url: `/projects/${projectId}/plan?phase=refine` });
      break;
    }
    case 'navigate_to_execute': {
      await db.update(project).set({ currentStage: 'execute', updatedAt: new Date() }).where(eq(project.id, projectId));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'execute'), eq(stage.status, 'pending')));
      projectEventBus.publish(projectId, { type: 'automation.navigate', url: `/projects/${projectId}/execute` });
      break;
    }
    case 'navigate_to_review': {
      await db.update(project).set({ currentStage: 'review', updatedAt: new Date() }).where(eq(project.id, projectId));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'review'), eq(stage.status, 'pending')));
      projectEventBus.publish(projectId, { type: 'automation.navigate', url: `/projects/${projectId}/review` });
      break;
    }
    case 'navigate_to_journal': {
      await db.update(project).set({ currentStage: 'journal', updatedAt: new Date() }).where(eq(project.id, projectId));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'journal'), eq(stage.status, 'pending')));
      projectEventBus.publish(projectId, { type: 'automation.navigate', url: `/projects/${projectId}/journal` });
      break;
    }

    // ── Complete ─────────────────────────────────────────────────────
    case 'advance_to_summary':
    case 'mark_complete': {
      const now = new Date();
      await db.update(project)
        .set({ phase: 'completed', completedAt: now, autoMode: false, updatedAt: now })
        .where(eq(project.id, projectId));
      await db.update(stage).set({ status: 'done', completedAt: now })
        .where(and(eq(stage.projectId, projectId), ne(stage.status, 'done')));
      break;
    }

    case 'error': {
      throw new Error(action.note);
    }

    default:
      break;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function extractAuditFindings(
  db: Db, projectId: string, scope: 'spec' | 'plan' | 'review', passNo: number,
): Promise<Array<{ severity: string; category: string; claim: string; evidence?: string; suggestion?: string }>> {
  const [pass] = await db.select({ mmaBatchId: auditPass.mmaBatchId })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, scope), eq(auditPass.passNo, passNo)))
    .limit(1);
  if (!pass?.mmaBatchId) return [];
  const [batch] = await db.select({ result: mmaBatch.result })
    .from(mmaBatch).where(eq(mmaBatch.id, pass.mmaBatchId)).limit(1);
  if (!batch?.result) return [];
  const r = batch.result as Record<string, unknown>;
  const output = (r.output ?? {}) as Record<string, unknown>;
  const summary = (output.summary ?? {}) as Record<string, unknown>;
  const findings = summary.findings;
  if (!Array.isArray(findings)) return [];
  return findings.map((f: Record<string, unknown>) => ({
    severity: String(f.weight ?? f.severity ?? ''),
    category: String(f.category ?? ''),
    claim: String(f.claim ?? ''),
    evidence: f.evidence ? String(f.evidence) : undefined,
    suggestion: f.suggestion ? String(f.suggestion) : undefined,
  }));
}

function extractReviewFindings(result: unknown): Array<{ weight: string; category: string; claim: string; file: string; suggestion: string }> {
  const r = result as Record<string, unknown>;
  const output = (r?.output ?? {}) as Record<string, unknown>;
  let summary = output.summary;
  if (typeof summary === 'string') {
    try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch { return []; }
  }
  const summaryObj = (summary && typeof summary === 'object' ? summary : {}) as Record<string, unknown>;
  const findings = summaryObj.findings;
  if (!Array.isArray(findings)) return [];
  return findings.map((f: Record<string, unknown>) => ({
    weight: String(f.weight ?? 'medium'),
    category: String(f.category ?? ''),
    claim: String(f.claim ?? ''),
    file: String(f.file ?? ''),
    suggestion: String(f.suggestion ?? ''),
  }));
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

function buildReviewFixPrompt(findings: Array<{ weight: string; category: string; claim: string; file: string; suggestion: string }>): string {
  const block = findings.map((f, i) => {
    let line = `${i + 1}. [${f.weight.toUpperCase()}] ${f.category}: ${f.claim}`;
    if (f.file) line += `\n   File: ${f.file}`;
    if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
    return line;
  }).join('\n\n');
  return `Role: You are a code fixer.\n\nTask: Apply every finding below to the codebase.\n\nFindings:\n\n${block}`;
}
