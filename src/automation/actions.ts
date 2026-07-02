import { eq, and, ne } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { planTask } from '@/db/schema/build';
import { learningCandidate } from '@/db/schema/learning';
import { auditPass } from '@/db/schema/artifacts';
import { participant } from '@/db/schema/participants';
import { mmaBatch } from '@/db/schema/ops';
import { specFilePath, planFilePath, readSpecFileAsync } from '@/projects/project-files';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import { advancePhase } from '@/projects/phase-tracker';
import type { AutoAction } from '@/automation/resolver';

export async function executeAction(projectId: string, action: AutoAction, db: Db = getDb()): Promise<void> {
  const cwd = resolveWorkspaceRoot();
  const mma = await buildMmaClient({ db });

  switch (action.kind) {
    case 'dispatch_spec_audit': {
      await dispatchMma({ db, mma, projectId, route: 'audit', handler: 'spec-audit', cwd,
        body: { type: 'audit', target: { filePaths: [specFilePath(projectId)] }, reviewPolicy: 'none' },
        actorId: null, await: true,
      });
      break;
    }

    case 'apply_spec_findings': {
      const passNo = (action.data?.passNo as number) ?? 1;
      const [pass] = await db.select({ id: auditPass.id }).from(auditPass)
        .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec'), eq(auditPass.passNo, passNo)))
        .limit(1);
      if (!pass) break;
      const [batch] = await db.select({ result: mmaBatch.result }).from(mmaBatch)
        .innerJoin(auditPass, eq(auditPass.mmaBatchId, mmaBatch.id))
        .where(eq(auditPass.id, pass.id))
        .limit(1);
      if (!batch?.result) break;
      const findings = extractFindings(batch.result);
      if (findings.length === 0) break;
      await dispatchMma({ db, mma, projectId, route: 'orchestrate', handler: 'spec-audit-apply', cwd,
        body: { prompt: buildApplyPrompt(specFilePath(projectId), findings), reviewPolicy: 'none' },
        meta: { passNo, findingsCount: findings.length },
        actorId: null, await: true,
      });
      break;
    }

    case 'freeze_spec': {
      await advancePhase(db, projectId, 'spec', 'finalize');
      await db.update(stage).set({ status: 'done', completedAt: new Date() })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'plan'), eq(stage.status, 'pending')));
      await db.update(project).set({ currentStage: 'plan', phase: 'build' }).where(eq(project.id, projectId));
      break;
    }

    case 'dispatch_plan_author': {
      const specFile = await readSpecFileAsync(projectId);
      const { PLAN_AUTHOR_SYSTEM_PROMPT } = await import('@/build/plan-author');
      const prompt = PLAN_AUTHOR_SYSTEM_PROMPT.replace('PLAN_FILE_PATH', planFilePath(projectId))
        + '\n\n# Locked Specification\n\n' + (specFile?.bodyMd ?? '');
      await dispatchMma({ db, mma, projectId, route: 'orchestrate', handler: 'plan-author', cwd,
        body: { prompt, reviewPolicy: 'none' },
        actorId: null, await: true,
      });
      break;
    }

    case 'approve_task': {
      const taskId = action.data?.taskId as string;
      if (!taskId) break;
      await db.update(planTask).set({ status: 'committed', updatedAt: new Date() }).where(eq(planTask.id, taskId));
      break;
    }

    case 'advance_plan_validate': {
      await advancePhase(db, projectId, 'plan', 'validate');
      break;
    }

    case 'dispatch_plan_audit': {
      await dispatchMma({ db, mma, projectId, route: 'audit', handler: 'plan-audit', cwd,
        body: { type: 'audit', subtype: 'plan', target: { filePaths: [planFilePath(projectId)] }, reviewPolicy: 'none' },
        actorId: null, await: true,
      });
      break;
    }

    case 'apply_plan_findings': {
      const passNo = (action.data?.passNo as number) ?? 1;
      const [pass] = await db.select({ id: auditPass.id }).from(auditPass)
        .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'plan'), eq(auditPass.passNo, passNo)))
        .limit(1);
      if (!pass) break;
      const [batch] = await db.select({ result: mmaBatch.result }).from(mmaBatch)
        .innerJoin(auditPass, eq(auditPass.mmaBatchId, mmaBatch.id))
        .where(eq(auditPass.id, pass.id))
        .limit(1);
      if (!batch?.result) break;
      const findings = extractFindings(batch.result);
      if (findings.length === 0) break;
      await dispatchMma({ db, mma, projectId, route: 'orchestrate', handler: 'plan-audit-apply', cwd,
        body: { prompt: buildApplyPrompt(planFilePath(projectId), findings), reviewPolicy: 'none' },
        meta: { passNo, findingsCount: findings.length },
        actorId: null, await: true,
      });
      break;
    }

    case 'lock_plan': {
      await advancePhase(db, projectId, 'plan', 'validate');
      await db.update(stage).set({ status: 'done', completedAt: new Date() })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'plan')));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'execute'), eq(stage.status, 'pending')));
      await db.update(project).set({ currentStage: 'execute' }).where(eq(project.id, projectId));
      break;
    }

    case 'dispatch_execute': {
      const { projectRepo } = await import('@/db/schema/projects');
      const { repo } = await import('@/db/schema/workspace');
      const repos = await db.select({ id: repo.id, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
        .from(projectRepo).innerJoin(repo, eq(projectRepo.repoId, repo.id))
        .where(eq(projectRepo.projectId, projectId));
      if (repos.length === 0) throw new Error('No repos linked to project');
      const r = repos[0];
      await db.update(planTask)
        .set({ targetRepoId: r.id, status: 'executing', branch: `forge/auto-${projectId.slice(0, 8)}`, updatedAt: new Date() })
        .where(eq(planTask.projectId, projectId));
      await dispatchMma({ db, mma, projectId, route: 'execute_plan', handler: 'execute-pipeline', cwd: r.pathOnDisk,
        body: { type: 'execute_plan', target: { paths: [planFilePath(projectId)] }, tasks: [], reviewPolicy: 'reviewed' },
        actorId: null, await: true,
      });
      break;
    }

    case 'advance_to_review': {
      await db.update(stage).set({ status: 'done', completedAt: new Date() })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'execute')));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'review'), eq(stage.status, 'pending')));
      await db.update(project).set({ currentStage: 'review' }).where(eq(project.id, projectId));
      break;
    }

    case 'dispatch_review': {
      await dispatchMma({ db, mma, projectId, route: 'review', handler: 'code-review', cwd,
        body: { type: 'review', reviewPolicy: 'none' },
        actorId: null, await: true,
      });
      break;
    }

    case 'apply_review_findings': {
      // Review apply uses the review-specific endpoint
      const passNo = (action.data?.passNo as number) ?? 1;
      await dispatchMma({ db, mma, projectId, route: 'orchestrate', handler: 'review-apply', cwd,
        body: { passNo },
        actorId: null, await: true,
      });
      break;
    }

    case 'advance_to_journal': {
      await db.update(stage).set({ status: 'done', completedAt: new Date() })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'review')));
      await db.update(stage).set({ status: 'active' })
        .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'journal'), eq(stage.status, 'pending')));
      await db.update(project).set({ currentStage: 'journal' }).where(eq(project.id, projectId));
      break;
    }

    case 'dispatch_harvest': {
      await dispatchMma({ db, mma, projectId, route: 'orchestrate', handler: 'journal-harvest', cwd,
        body: { type: 'journal_record', reviewPolicy: 'none' },
        actorId: null, await: true,
      });
      break;
    }

    case 'approve_learning': {
      const learningId = action.data?.learningId as string;
      if (!learningId) break;
      await db.update(learningCandidate).set({ status: 'kept' }).where(eq(learningCandidate.id, learningId));
      break;
    }

    case 'dispatch_record': {
      await dispatchMma({ db, mma, projectId, route: 'orchestrate', handler: 'journal-record', cwd,
        body: { type: 'journal_record', reviewPolicy: 'none' },
        actorId: null, await: true,
      });
      break;
    }

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

function extractFindings(result: unknown): Array<{ severity: string; category: string; claim: string; evidence?: string; suggestion?: string }> {
  const r = result as Record<string, unknown>;
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

function buildApplyPrompt(filePath: string, findings: Array<{ severity: string; category: string; claim: string; evidence?: string; suggestion?: string }>): string {
  const block = findings.map((f, i) => {
    let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.claim}`;
    if (f.evidence) line += `\n   Evidence: ${f.evidence}`;
    if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
    return line;
  }).join('\n\n');
  return `Role: You are a specification reviser.\n\nTask: Read the file at \`${filePath}\`, apply every finding below, write the revised file back.\n\nFindings:\n\n${block}`;
}
