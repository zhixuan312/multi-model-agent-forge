import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { mmaBatch } from '@/db/schema/mma';
import { project } from '@/db/schema/projects';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { getLatestPlanArtifact } from '@/build/plan-author';
import { connectionSettings } from '@/db/schema/config';
import { writePlanFile, nodePlanFs } from '@/build/plan-fs';
import { buildForgeBranch } from '@/build/execute-core';
import { projectShortId, planFileName } from '@/build/slug';
import { buildMmaClient } from '@/mma/server-client';
import { projectEventBus } from '@/sse/event-bus';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { createBuildPr } from '@/build/pr';
import { logAction } from '@/observability/action-log';
import { execFileSync } from 'node:child_process';

export const runtime = 'nodejs';

const bodySchema = z.object({
  repos: z.array(z.object({ repoId: z.string(), targetBranch: z.string() })).default([]),
});

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const csrf = rejectCrossOrigin(_req);
  if (csrf) return csrf;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const db = getDb();
  const json = await _req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  let repoList = parsed.success ? parsed.data.repos : [];

  if (repoList.length === 0) {
    const rows = await db
      .select({ id: repo.id, defaultBranch: repo.defaultBranch })
      .from(projectRepo)
      .innerJoin(repo, eq(projectRepo.repoId, repo.id))
      .where(eq(projectRepo.projectId, id));
    repoList = rows.map((r) => ({ repoId: r.id, targetBranch: r.defaultBranch }));
  }

  const planArtifact = await getLatestPlanArtifact(db, id);
  if (!planArtifact?.bodyMd) return NextResponse.json({ error: 'No plan artifact.' }, { status: 400 });

  const mma = await buildMmaClient();
  const shortId = projectShortId(id);
  const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, id));
  const forgeBranch = buildForgeBranch(proj?.name ?? id, shortId);
  const planFile = `.forge/${planFileName(id)}`;

  const dispatched: Array<{ repoId: string; batchId: string }> = [];
  const errors: Array<{ repoId: string; error: string }> = [];

  for (const { repoId, targetBranch } of repoList) {
    const [repoRow] = await db
      .select({ name: repo.name, pathOnDisk: repo.pathOnDisk })
      .from(repo)
      .where(eq(repo.id, repoId))
      .limit(1);
    if (!repoRow) { errors.push({ repoId, error: 'Repo not found' }); continue; }

    // 1. Create forge branch from target (or checkout if it exists)
    try {
      const branchExists = execFileSync('git', ['-C', repoRow.pathOnDisk, 'branch', '--list', forgeBranch], { encoding: 'utf8' }).trim();
      if (branchExists) {
        execFileSync('git', ['-C', repoRow.pathOnDisk, 'checkout', forgeBranch]);
      } else {
        execFileSync('git', ['-C', repoRow.pathOnDisk, 'fetch', 'origin', targetBranch], { timeout: 30_000 });
        execFileSync('git', ['-C', repoRow.pathOnDisk, 'checkout', '-b', forgeBranch, `origin/${targetBranch}`]);
      }
    } catch (err) {
      errors.push({ repoId, error: `Branch: ${(err as Error).message}` });
      continue;
    }

    // 2. Write plan file on the forge branch
    try {
      await writePlanFile(nodePlanFs, repoRow.pathOnDisk, id, planArtifact.bodyMd);
    } catch (err) {
      errors.push({ repoId, error: `Plan write: ${(err as Error).message}` });
      continue;
    }

    // 3. Dispatch to MMA (it creates worktree from current branch = forgeBranch)
    const tasks = await db
      .select({ title: planTask.title, id: planTask.id })
      .from(planTask)
      .where(and(eq(planTask.projectId, id), eq(planTask.targetRepoId, repoId)));

    let batchId: string;
    try {
      ({ batchId } = await mma.executePlan(repoRow.pathOnDisk, {
        planPath: planFile,
        tasks: [],
        reviewPolicy: 'reviewed',
      }));
    } catch (err) {
      errors.push({ repoId, error: `MMA: ${(err as Error).message}` });
      continue;
    }

    const [batchRow] = await db
      .insert(mmaBatch)
      .values({
        projectId: id,
        route: 'execute_plan',
        handler: 'execute-pipeline',
        cwd: repoRow.pathOnDisk,
        batchId,
        status: 'dispatched',
        targetRepoId: repoId,
        request: { forgeBranch, targetBranch, tasks: tasks.map((t) => t.title) },
        dispatchedBy: me.id,
      })
      .returning({ id: mmaBatch.id });

    await db
      .update(planTask)
      .set({ status: 'executing', targetBranch, mmaBatchId: batchRow.id, branch: forgeBranch, updatedAt: new Date() })
      .where(and(eq(planTask.projectId, id), eq(planTask.targetRepoId, repoId)));

    dispatched.push({ repoId, batchId: batchRow.id });

    pollAndFinalize(mma, db, batchId, batchRow.id, id, repoId, repoRow.name, repoRow.pathOnDisk, forgeBranch, targetBranch, tasks, proj?.name ?? id, me.id).catch((err) => {
      projectEventBus.publish(id, { type: 'dispatch.failed', batchId: batchRow.id, handler: 'execute-pipeline', error: (err as Error).message, repoId });
    });
  }

  if (dispatched.length === 0) return NextResponse.json({ error: 'All repos failed', errors }, { status: 502 });
  return NextResponse.json({ dispatched, ...(errors.length > 0 ? { errors } : {}) }, { status: 202 });
}

async function pollAndFinalize(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
  repoId: string,
  repoName: string,
  repoPath: string,
  forgeBranch: string,
  targetBranch: string,
  tasks: Array<{ id: string; title: string }>,
  projectName: string,
  actorId: string,
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await mma.poll(mmaBatchId);

    if (res.state === 'pending') {
      await db.update(mmaBatch).set({ status: 'running' }).where(eq(mmaBatch.id, batchRowId));
      projectEventBus.publish(projectId, {
        type: 'dispatch.progress',
        batchId: batchRowId,
        handler: 'execute-pipeline',
        phase: res.phase ?? 'running',
        elapsedMs: res.elapsedMs ?? 0,
        totalTasks: res.totalTasks,
        repoId,
      });
      continue;
    }

    if (res.state === 'not_found') {
      throw new Error('MMA task no longer exists — the server may have restarted.');
    }

    const envelope = res.envelope as Record<string, unknown> | null;
    // MMA returns flat { code, message } on match errors (no task/output wrapper)
    const isFlatError = envelope && typeof envelope.code === 'string' && typeof envelope.message === 'string' && !envelope.task;
    const error = isFlatError
      ? { code: envelope.code as string, message: envelope.message as string }
      : (envelope?.error as { code: string; message: string } | null);
    const usage = extractUsageFields(envelope);

    await db.update(mmaBatch).set({
      status: error ? 'failed' : 'done',
      result: envelope as object,
      terminalAt: new Date(),
      ...(usage.costUsd && { costUsd: usage.costUsd }),
      ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
    }).where(eq(mmaBatch.id, batchRowId));

    if (!error) {
      await db.update(planTask).set({ status: 'committed', updatedAt: new Date() })
        .where(and(eq(planTask.projectId, projectId), eq(planTask.targetRepoId, repoId)));

      // 4. Push forge branch to origin
      try {
        execFileSync('git', ['-C', repoPath, 'push', 'origin', forgeBranch, '--force'], { timeout: 60_000 });
      } catch (pushErr) {
        console.error(`[forge] git push failed for ${repoName}:`, pushErr);
      }

      // 5. Create PR: forgeBranch → targetBranch
      try {
        const pr = await createBuildPr(
          {
            readGitToken: async () => {
              const [row] = await db.select({ ref: connectionSettings.gitTokenRef }).from(connectionSettings).limit(1);
              if (!row?.ref) return null;
              const { PostgresSecretStore } = await import('@/secrets/secret-store');
              const secrets = await PostgresSecretStore.create({ db });
              return secrets.get(row.ref);
            },
            parseRemote: (path) => parseGitRemote(path),
            branchHasChanges: async () => true,
            fetch: globalThis.fetch,
          },
          {
            projectName,
            branch: forgeBranch,
            targetBranch,
            repoPath,
            tasks: tasks.map((t) => ({ title: t.title, commitSha: null })),
          },
        );
        if (pr && 'url' in pr) {
          await db.update(project).set({
            buildPrs: sql`jsonb_set(COALESCE(build_prs, '{}'::jsonb), ${sql.raw(`'{${repoId}}'`)}, ${sql.raw(`'${JSON.stringify({ url: pr.url, branch: forgeBranch, targetBranch })}'`)}::jsonb)`,
          }).where(eq(project.id, projectId));
          await logAction({ projectId, memberId: actorId, action: 'create_pr', target: `repo:${repoName}` }, db);
        }
      } catch (prErr) {
        console.error(`[forge] PR creation failed for ${repoName}:`, prErr);
      }

      projectEventBus.publish(projectId, { type: 'dispatch.done', batchId: batchRowId, handler: 'execute-pipeline', repoId });
    } else {
      await db.update(planTask).set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(planTask.projectId, projectId), eq(planTask.targetRepoId, repoId)));
      projectEventBus.publish(projectId, { type: 'dispatch.failed', batchId: batchRowId, handler: 'execute-pipeline', error: error.message, repoId });
    }
    break;
  }
}

function parseGitRemote(repoPath: string): { owner: string; repo: string } | null {
  try {
    const url = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch {
    return null;
  }
}
