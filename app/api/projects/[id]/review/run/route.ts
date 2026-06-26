import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { buildMmaClient } from '@/mma/server-client';
import { projectEventBus } from '@/sse/event-bus';
import { extractUsageFields } from '@/usage/extract-usage-fields';

export const runtime = 'nodejs';

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

  // Get repos
  const repos = await db
    .select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, id));

  if (repos.length === 0) return NextResponse.json({ error: 'No repos' }, { status: 400 });

  // Get changed files from latest execute batch
  const [execBatch] = await db
    .select({ result: mmaBatch.result, targetRepoId: mmaBatch.targetRepoId })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'execute_plan'), eq(mmaBatch.status, 'done')))
    .orderBy(desc(mmaBatch.createdAt))
    .limit(1);

  const mma = await buildMmaClient();
  const dispatched: Array<{ repoId: string; batchId: string }> = [];

  for (const repoRow of repos) {
    // Get changed files for this repo from execute result
    let changedFiles: string[] = [];
    if (execBatch?.result) {
      const env = execBatch.result as Record<string, unknown>;
      const output = (env.output ?? {}) as Record<string, unknown>;
      if (Array.isArray(output.filesChanged)) {
        changedFiles = output.filesChanged as string[];
      }
    }

    let batchId: string;
    try {
      ({ batchId } = await mma.review(repoRow.pathOnDisk, {
        paths: changedFiles.length > 0 ? changedFiles : undefined,
        prompt: 'Review all changed files for correctness, security, performance, cross-file ripple, test gaps, and style issues.',
      }));
    } catch (err) {
      console.error(`[forge] review dispatch failed for ${repoRow.name}:`, err);
      continue;
    }

    const [batchRow] = await db
      .insert(mmaBatch)
      .values({
        projectId: id,
        route: 'review',
        handler: 'code-review',
        cwd: repoRow.pathOnDisk,
        batchId,
        status: 'dispatched',
        targetRepoId: repoRow.id,
        request: { prompt: 'code review', filesCount: changedFiles.length },
        dispatchedBy: me.id,
      })
      .returning({ id: mmaBatch.id });

    dispatched.push({ repoId: repoRow.id, batchId: batchRow.id });

    // Background poll
    pollReview(mma, db, batchId, batchRow.id, id, repoRow.id).catch((err) => {
      projectEventBus.publish(id, { type: 'dispatch.failed', batchId: batchRow.id, handler: 'code-review', error: (err as Error).message, repoId: repoRow.id });
    });
  }

  if (dispatched.length === 0) return NextResponse.json({ error: 'All repos failed' }, { status: 502 });
  return NextResponse.json({ dispatched }, { status: 202 });
}

async function pollReview(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
  repoId: string,
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await mma.poll(mmaBatchId);
    if (res.state === 'pending') {
      await db.update(mmaBatch).set({ status: 'running' }).where(eq(mmaBatch.id, batchRowId));
      projectEventBus.publish(projectId, {
        type: 'dispatch.progress', batchId: batchRowId, handler: 'code-review',
        phase: res.phase ?? 'running', elapsedMs: res.elapsedMs ?? 0, repoId,
      });
      continue;
    }
    if (res.state === 'not_found') {
      throw new Error('MMA task no longer exists — the server may have restarted.');
    }
    const envelope = res.envelope as Record<string, unknown> | null;
    const task = (envelope?.task ?? {}) as Record<string, unknown>;
    const taskStatus = task.status as string | undefined;
    // done_with_concerns is a SUCCESS — findings exist but the review completed
    const isSuccess = taskStatus === 'done' || taskStatus === 'done_with_concerns';
    const isFlatError = envelope && typeof envelope.code === 'string' && !envelope.task;
    const error = isFlatError
      ? { code: envelope.code as string, message: envelope.message as string }
      : (!isSuccess && taskStatus === 'failed')
        ? (envelope?.error as { code: string; message: string } | null) ?? { code: 'pipeline_failed', message: 'Review failed' }
        : null;
    const usage = extractUsageFields(envelope);

    await db.update(mmaBatch).set({
      status: error ? 'failed' : 'done',
      result: envelope as object,
      terminalAt: new Date(),
      ...(usage.costUsd && { costUsd: usage.costUsd }),
      ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
    }).where(eq(mmaBatch.id, batchRowId));

    if (error) {
      projectEventBus.publish(projectId, { type: 'dispatch.failed', batchId: batchRowId, handler: 'code-review', error: error.message, repoId });
    } else {
      projectEventBus.publish(projectId, { type: 'dispatch.done', batchId: batchRowId, handler: 'code-review', repoId });
    }
    break;
  }
}
