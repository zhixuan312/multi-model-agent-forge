import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { planFilePath, readPlanFileAsync } from '@/projects/project-files';
import { buildForgeBranch } from '@/build/execute-core';
import { projectShortId } from '@/build/slug';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { execFileSync } from 'node:child_process';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
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

  const existing = await findInflight(db, id, 'execute-pipeline');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const json = await _req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  let repoList = parsed.success ? parsed.data.repos : [];

  // Get repos from details if not provided
  if (repoList.length === 0) {
    const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
    if (projRow?.details) {
      const d = validateDetails(projRow.details);
      repoList = d.repos.map((r) => ({ repoId: r.id, targetBranch: r.defaultBranch }));
    }
  }

  const planArtifact = await readPlanFileAsync(id);
  if (!planArtifact?.bodyMd) return NextResponse.json({ error: 'No plan artifact.' }, { status: 400 });

  const planPath = planFilePath(id);

  const mma = await buildMmaClient({ db });
  const shortId = projectShortId(id);
  const [proj] = await db.select({ name: project.name, details: project.details }).from(project).where(eq(project.id, id));
  const forgeBranch = buildForgeBranch(proj?.name ?? id, shortId);

  const d = proj?.details ? validateDetails(proj.details) : null;

  const dispatched: Array<{ repoId: string; batchId: string }> = [];
  const errors: Array<{ repoId: string; error: string }> = [];

  for (const { repoId, targetBranch } of repoList) {
    const [repoRow] = await db
      .select({ name: repo.name, pathOnDisk: repo.pathOnDisk })
      .from(repo)
      .where(eq(repo.id, repoId))
      .limit(1);
    if (!repoRow) { errors.push({ repoId, error: 'Repo not found' }); continue; }

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

    try {
      const taskTitles = d?.stages.plan.phases.refine.tasks
        .filter((t) => t.targetRepoId === repoId)
        .map((t) => t.title) ?? [];

      const { batchRowId } = await dispatchMma({
        db,
        mma,
        projectId: id,
        route: 'execute_plan',
        handler: 'execute-pipeline',
        cwd: repoRow.pathOnDisk,
        body: {
          type: 'execute_plan',
          target: { paths: [planPath] },
          tasks: [],
          reviewPolicy: 'reviewed',
        },
        actorId: me.id,
        meta: {
          forgeBranch,
          targetBranch,
          repoId,
          actorId: me.id,
          tasks: taskTitles,
        },
      });

      // Mark tasks as executing in details
      await updateDetails(db, id, (det) => {
        for (const t of det.stages.plan.phases.refine.tasks) {
          if (t.targetRepoId === repoId) {
            t.status = 'executing';
            t.targetBranch = targetBranch;
            t.branch = forgeBranch;
          }
        }
        return det;
      });

      dispatched.push({ repoId, batchId: batchRowId });
    } catch (err) {
      errors.push({ repoId, error: `MMA: ${(err as Error).message}` });
    }
  }

  if (dispatched.length === 0) return NextResponse.json({ error: 'All repos failed', errors }, { status: 502 });

  // Advance execute phase in details
  await updateDetails(db, id, (det) => {
    const exe = det.stages.execute;
    if (exe.status === 'pending') exe.status = 'active';
    return det;
  });

  return NextResponse.json({ dispatched, ...(errors.length > 0 ? { errors } : {}) }, { status: 202 });
}
