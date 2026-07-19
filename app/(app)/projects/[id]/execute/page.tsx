import { notFound, redirect } from 'next/navigation';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { buildPr, project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { groupTasksByRepo, listRemoteBranches } from '@/build/execute-core';
import { projectShortId } from '@/build/slug';
import { ExecuteStageClient, type RepoTerminalResult } from '@/components/forge/ExecuteStageClient';
import { validateDetails } from '@/details/schema';

export default async function ExecuteStagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ phase?: string }> }) {
  const { id } = await params;
  const { phase: urlPhase } = await searchParams;
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  if (!actor) redirect('/');

  try {
    await assertProjectReadable(id, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const proj = await getProject(id);
  if (!proj) notFound();

  const db = getDb();

  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  // READ-ONLY render — do NOT activate the execute stage or write current_stage on
  // visit. Stage progression is owned by the auto-driver and the /advance route.
  // Read tasks from details + resolve repo metadata
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  const d = projRow?.details ? validateDetails(projRow.details) : null;
  const detailsTasks = d?.stages.plan.phases.refine.tasks ?? [];
  const detailsRepos = d?.repos ?? [];

  // Build task rows for groupTasksByRepo
  const repoMap = new Map<string, { name: string; pathOnDisk: string; defaultBranch: string }>();
  for (const r of detailsRepos) {
    repoMap.set(r.id, { name: r.name, pathOnDisk: r.pathOnDisk, defaultBranch: r.defaultBranch });
  }

  const tasks = detailsTasks.map((t, i) => {
    const repoId = t.targetRepoId ?? detailsRepos[0]?.id ?? '';
    const r = repoMap.get(repoId);
    return {
      id: t.id,
      title: t.title,
      orderIndex: t.orderIndex ?? i,
      targetRepoId: repoId,
      status: t.status,
      phase: t.phase ?? null,
      branch: t.branch ?? null,
      commitSha: t.commitSha ?? null,
      repoName: r?.name ?? '',
      repoPath: r?.pathOnDisk ?? '',
      defaultBranch: r?.defaultBranch ?? 'main',
    };
  });

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

  // Resolve initial phase from URL > derived
  const validPhases = ['configure', 'implement'] as const;
  type ExecPhase = typeof validPhases[number];
  const { inferExecutePhase } = await import('@/build/execute-types');
  const derivedPhase = inferExecutePhase(groups);
  const initialPhase: ExecPhase | undefined = urlPhase != null && (validPhases as readonly string[]).includes(urlPhase)
    ? (urlPhase as ExecPhase)
    : derivedPhase;

  return (
    <ExecuteStageClient
      projectId={id}
      projectName={proj.name}
      phase={proj.phase}
      repoGroups={groups}
      buildPrs={Object.fromEntries(
        (await db.select({ repoId: buildPr.repoId, url: buildPr.url, branch: buildPr.branch, targetBranch: buildPr.targetBranch })
          .from(buildPr).where(eq(buildPr.projectId, id)))
          .map(r => [r.repoId, { url: r.url, branch: r.branch, targetBranch: r.targetBranch }])
      )}
      terminalResults={terminalResults}
      initialPhase={initialPhase}
      readOnly={!perms.execute.canMutate}
      lockedReason={perms.execute.reason}
    />
  );
}
