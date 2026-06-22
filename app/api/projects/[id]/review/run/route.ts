import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
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

/**
 * `POST /api/projects/[id]/review/run` — dispatch a code review via MMA.
 * Sends all changed files from the execute stage to MMA's review route.
 * Returns 202 immediately; polls in the background and emits SSE on completion.
 */
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
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw e;
  }

  const db = getDb();

  // Get the project's first repo for cwd
  const repos = await db
    .select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, id))
    .limit(1);

  if (repos.length === 0) {
    return NextResponse.json({ error: 'No repos associated with project.' }, { status: 400 });
  }

  const repoMeta = repos[0];

  // Dispatch MMA review
  const mma = await buildMmaClient();
  let batchId: string;
  try {
    ({ batchId } = await mma.review(repoMeta.pathOnDisk, {
      prompt: 'Review the latest changes for correctness, security, performance, and style issues.',
    }));
  } catch (err) {
    return NextResponse.json(
      { error: `MMA dispatch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Record the batch
  const [batchRow] = await db
    .insert(mmaBatch)
    .values({
      projectId: id,
      route: 'review',
      handler: 'code-review',
      cwd: repoMeta.pathOnDisk,
      batchId,
      status: 'dispatched',
      request: { prompt: 'code review' },
      dispatchedBy: me.id,
    })
    .returning({ id: mmaBatch.id });

  // Emit initial progress
  projectEventBus.publish(id, {
    type: 'dispatch.progress',
    batchId: batchRow.id,
    handler: 'code-review',
    phase: 'implementing',
    elapsedMs: 0,
  });

  // Background poll
  pollReview(mma, db, batchId, batchRow.id, id).catch((err) => {
    console.error(`[forge] review poll failed for project ${id}:`, err);
    projectEventBus.publish(id, {
      type: 'dispatch.failed',
      batchId: batchRow.id,
      handler: 'code-review',
      error: (err as Error).message,
    });
  });

  return NextResponse.json({ ok: true, batchId: batchRow.id }, { status: 202 });
}

async function pollReview(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await mma.poll(mmaBatchId);

    if (res.state === 'pending') {
      await db.update(mmaBatch).set({ status: 'running' }).where(eq(mmaBatch.id, batchRowId));
      projectEventBus.publish(projectId, {
        type: 'dispatch.progress',
        batchId: batchRowId,
        handler: 'code-review',
        phase: res.phase ?? 'running',
        elapsedMs: res.elapsedMs ?? 0,
      });
      continue;
    }

    // Terminal
    const envelope = res.envelope as Record<string, unknown> | null;
    const error = envelope?.error as { code: string; message: string } | null;
    const usage = extractUsageFields(envelope);

    await db.update(mmaBatch).set({
      status: error ? 'failed' : 'done',
      result: envelope as object,
      terminalAt: new Date(),
      ...(usage.costUsd && { costUsd: usage.costUsd }),
      ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
    }).where(eq(mmaBatch.id, batchRowId));

    projectEventBus.publish(projectId, {
      type: 'dispatch.done',
      batchId: batchRowId,
      handler: 'code-review',
    });

    break;
  }
}
