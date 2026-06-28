import { notFound, redirect } from 'next/navigation';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { mmaBatch } from '@/db/schema/mma';
import { repo } from '@/db/schema/workspace';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { groupTasksByRepo, listRemoteBranches } from '@/build/execute-core';
import { projectShortId } from '@/build/slug';
import { ExecuteStageClient, type RepoTerminalResult } from '@/components/forge/ExecuteStageClient';

export default async function ExecuteStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ phase?: string }> }) {
  const { id } = await params;
  const { phase: urlPhase } = await searchParams;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const proj = await getProject(id);
  if (!proj) notFound();

  const db = getDb();

  // Activate the execute stage + update current_stage on visit
  const { stage } = await import('@/db/schema/projects');
  const { project } = await import('@/db/schema/projects');
  const { and: deq2, eq: deq } = await import('drizzle-orm');
  await db.update(stage).set({ status: 'active' }).where(deq2(deq(stage.projectId, id), deq(stage.kind, 'execute'), deq(stage.status, 'pending')));
  await db.update(project).set({ currentStage: 'execute' }).where(eq(project.id, id));
  const tasks = await db
    .select({
      id: planTask.id, title: planTask.title, orderIndex: planTask.orderIndex,
      targetRepoId: planTask.targetRepoId, status: planTask.status,
      branch: planTask.branch, commitSha: planTask.commitSha,
      repoName: repo.name, repoPath: repo.pathOnDisk, defaultBranch: repo.defaultBranch,
    })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id))
    .orderBy(planTask.orderIndex);

  const shortId = projectShortId(id);
  const groups = groupTasksByRepo(tasks, proj.name, shortId);

  for (const g of groups) {
    const remote = await listRemoteBranches(g.pathOnDisk);
    if (remote.length > 0) g.branches = remote;
  }

  // Load terminal results per repo from ops_mma_batch
  const terminalResults: Record<string, RepoTerminalResult> = {};
  const batches = await db
    .select({ targetRepoId: mmaBatch.targetRepoId, result: mmaBatch.result, status: mmaBatch.status, costUsd: mmaBatch.costUsd, durationMs: mmaBatch.durationMs })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'execute_plan')))
    .orderBy(desc(mmaBatch.createdAt));

  const firstRepoId = groups[0]?.repoId;
  for (const b of batches) {
    const rid = b.targetRepoId ?? firstRepoId;
    if (!rid || terminalResults[rid]) continue;
    const env = b.result as Record<string, unknown> | null;
    const output = (env?.output ?? {}) as Record<string, unknown>;
    const metrics = (env?.metrics ?? {}) as Record<string, unknown>;
    const execution = (env?.execution ?? {}) as Record<string, unknown>;
    const worktree = (execution.worktree ?? {}) as Record<string, unknown>;
    const filesChanged = Array.isArray(output.filesChanged) ? output.filesChanged as string[] : [];

    terminalResults[rid] = {
      status: b.status as 'done' | 'failed',
      durationMs: typeof metrics.totalDurationMs === 'number' ? metrics.totalDurationMs : (b.durationMs ?? null),
      costUsd: typeof metrics.totalCostUsd === 'number' ? metrics.totalCostUsd : (b.costUsd ? Number(b.costUsd) : null),
      filesChanged,
      worktreeMerged: worktree.merged === true,
      branch: typeof worktree.branch === 'string' ? worktree.branch : null,
    };
  }

  // Load review passes
  const reviewBatches = await db
    .select({ result: mmaBatch.result, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  const applyBatches = await db
    .select({ request: mmaBatch.request, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'delegate'), eq(mmaBatch.handler, 'review-apply'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  const reviewPasses = reviewBatches.map((b, i) => {
    const passNo = i + 1;
    const env = b.result as Record<string, unknown> | null;
    const output = (env?.output ?? {}) as Record<string, unknown>;
    let summary = output.summary;
    if (typeof summary === 'string') {
      try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch {}
    }
    const summaryObj = (summary && typeof summary === 'object' ? summary : {}) as Record<string, unknown>;
    const findings = Array.isArray(summaryObj.findings) ? summaryObj.findings as Array<Record<string, unknown>> : [];
    const appliedForPass = applyBatches
      .filter((ab) => (ab.request as Record<string, unknown> | null)?.passNo === passNo)
      .flatMap((ab) => { const req = ab.request as Record<string, unknown> | null; return Array.isArray(req?.findingIndices) ? req.findingIndices as number[] : []; });
    return {
      passNo,
      status: 'done' as const,
      findings: findings.map((f) => ({
        weight: (f.weight as string) ?? 'medium', category: (f.category as string) ?? '',
        claim: (f.claim as string) ?? '', evidence: (f.evidence as string) ?? '',
        file: (f.file as string) ?? '', line: typeof f.line === 'number' ? f.line : 0,
        suggestion: (f.suggestion as string) ?? '',
      })),
      appliedIndices: [...new Set(appliedForPass)],
    };
  });

  // Resolve initial phase from URL > last saved > derived
  const validPhases = ['configure', 'monitor'] as const;
  type ExecPhase = typeof validPhases[number];
  const { getLastPhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getLastPhase(db, id, 'execute') as ExecPhase | null;
  const initialPhase: ExecPhase | undefined = validPhases.includes(urlPhase as any)
    ? (urlPhase as ExecPhase)
    : lastPhase ?? undefined;

  const [runningReview] = await db.select({ id: mmaBatch.id }).from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'running'))).limit(1);
  const [runningApply] = await db.select({ id: mmaBatch.id }).from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'delegate'), eq(mmaBatch.handler, 'review-apply'), eq(mmaBatch.status, 'running'))).limit(1);

  return (
    <ExecuteStageClient
      projectId={id}
      projectName={proj.name}
      phase={proj.phase as any}
      repoGroups={groups}
      buildPrs={(proj.buildPrs ?? {}) as Record<string, { url: string; branch: string; targetBranch: string }>}
      terminalResults={terminalResults}
      reviewPasses={reviewPasses}
      reviewRunning={!!runningReview}
      applyRunning={!!runningApply}
      initialPhase={initialPhase}
    />
  );
}
