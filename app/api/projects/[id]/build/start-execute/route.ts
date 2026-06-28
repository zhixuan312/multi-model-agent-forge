import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { project } from '@/db/schema/projects';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { getLatestPlanArtifact } from '@/build/plan-author';
import { writePlanFile, nodePlanFs } from '@/build/plan-fs';
import { buildForgeBranch } from '@/build/execute-core';
import { projectShortId, planFileName } from '@/build/slug';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { execFileSync } from 'node:child_process';
import '@/dispatch/handler-registry';

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

  // Prevent duplicate dispatch
  const existing = await findInflight(db, id, 'execute-pipeline');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

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

  const mma = await buildMmaClient({ db });
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

    // 3. Dispatch via centralized PollManager + handler registry
    try {
      const batchRowId = await dispatchAndRegister({
        db,
        mma,
        projectId: id,
        route: 'execute_plan',
        handler: 'execute-pipeline',
        cwd: repoRow.pathOnDisk,
        body: {
          type: 'execute_plan',
          target: { paths: [planFile] },
          tasks: [],
          reviewPolicy: 'reviewed',
        },
        actorId: me.id,
        meta: {
          forgeBranch,
          targetBranch,
          repoId,
          actorId: me.id,
          tasks: (await db.select({ title: planTask.title }).from(planTask)
            .where(and(eq(planTask.projectId, id), eq(planTask.targetRepoId, repoId)))).map((t) => t.title),
        },
      });

      // Mark tasks as executing
      await db.update(planTask)
        .set({ status: 'executing', targetBranch, branch: forgeBranch, updatedAt: new Date() })
        .where(and(eq(planTask.projectId, id), eq(planTask.targetRepoId, repoId)));

      dispatched.push({ repoId, batchId: batchRowId });
    } catch (err) {
      errors.push({ repoId, error: `MMA: ${(err as Error).message}` });
    }
  }

  if (dispatched.length === 0) return NextResponse.json({ error: 'All repos failed', errors }, { status: 502 });
  return NextResponse.json({ dispatched, ...(errors.length > 0 ? { errors } : {}) }, { status: 202 });
}
