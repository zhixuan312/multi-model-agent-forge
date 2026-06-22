import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { mmaBatch } from '@/db/schema/mma';
import { buildMmaClient } from '@/mma/server-client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { parseTags } from '@/journal/journal-core';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { projectEventBus } from '@/sse/event-bus';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const csrf = rejectCrossOrigin(req);
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

  // Single-flight guard: a journal-record dispatch already in progress.
  const inFlight = await db
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(
      and(
        eq(mmaBatch.projectId, id),
        eq(mmaBatch.handler, 'journal-record'),
        inArray(mmaBatch.status, ['dispatched', 'running']),
      ),
    )
    .limit(1);
  if (inFlight.length > 0) {
    return NextResponse.json({ error: 'A record run is already in progress' }, { status: 409 });
  }

  // Load all kept learnings for the project.
  const kept = await db
    .select({ id: learningCandidate.id, bodyMd: learningCandidate.bodyMd })
    .from(learningCandidate)
    .where(and(eq(learningCandidate.projectId, id), eq(learningCandidate.status, 'kept')));

  if (kept.length === 0) {
    return NextResponse.json({ error: 'No kept learnings to record' }, { status: 400 });
  }

  const cwd = resolveWorkspaceRoot();
  const prompt = buildRecordPrompt(kept);

  const mma = await buildMmaClient();
  let batchId: string;
  try {
    ({ batchId } = await mma.dispatch('journal-record', {
      cwd,
      body: { type: 'journal_record', prompt },
    }));
  } catch (err) {
    return NextResponse.json(
      { error: `MMA dispatch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const [batchRow] = await db
    .insert(mmaBatch)
    .values({
      projectId: id,
      route: 'journal_record',
      handler: 'journal-record',
      cwd,
      batchId,
      status: 'dispatched',
      request: { learningCount: kept.length },
      dispatchedBy: me.id,
    })
    .returning({ id: mmaBatch.id });

  const learningIds = kept.map((l) => l.id);

  pollAndMark(mma, db, batchId, batchRow.id, id, learningIds).catch((err) => {
    console.error(`[forge] journal record failed for project ${id}:`, err);
    projectEventBus.publish(id, {
      type: 'dispatch.failed',
      batchId: batchRow.id,
      handler: 'journal-record',
      error: (err as Error).message,
    });
  });

  return NextResponse.json({ ok: true, batchId: batchRow.id }, { status: 202 });
}

function buildRecordPrompt(kept: Array<{ id: string; bodyMd: string }>): string {
  const lines = kept.map((l) => {
    const { category, source, text } = parseTags(l.bodyMd);
    return `- id=${l.id} | category=${category ?? 'insight'} | source=${source ?? 'Manual'} | ${text}`;
  });
  return `Record the following approved learnings to the team journal. Each line is one learning keyed by its id.

${lines.join('\n')}`;
}

async function pollAndMark(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
  learningIds: string[],
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await mma.poll(mmaBatchId);

    if (res.state === 'pending') {
      await db.update(mmaBatch).set({ status: 'running' }).where(eq(mmaBatch.id, batchRowId));
      projectEventBus.publish(projectId, {
        type: 'dispatch.progress',
        batchId: batchRowId,
        handler: 'journal-record',
        phase: res.phase ?? 'running',
        elapsedMs: res.elapsedMs ?? 0,
      });
      continue;
    }

    const envelope = res.envelope as Record<string, unknown> | null;
    const task = (envelope?.task ?? {}) as Record<string, unknown>;
    const taskStatus = task.status as string | undefined;
    // done_with_concerns is a SUCCESS — the record completed.
    const isSuccess = taskStatus === 'done' || taskStatus === 'done_with_concerns';
    const isFlatError = envelope && typeof envelope.code === 'string' && !envelope.task;
    const error = isFlatError
      ? { code: envelope.code as string, message: envelope.message as string }
      : (!isSuccess && taskStatus === 'failed')
        ? (envelope?.error as { code: string; message: string } | null) ?? { code: 'pipeline_failed', message: 'Record failed' }
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
      projectEventBus.publish(projectId, {
        type: 'dispatch.failed',
        batchId: batchRowId,
        handler: 'journal-record',
        error: error.message,
      });
      break;
    }

    const output = (envelope?.output ?? {}) as Record<string, unknown>;
    const recordedNodeId =
      typeof output.contextBlockId === 'string' ? output.contextBlockId : null;

    if (learningIds.length > 0) {
      await db
        .update(learningCandidate)
        .set({ status: 'recorded', ...(recordedNodeId && { recordedNodeId }) })
        .where(inArray(learningCandidate.id, learningIds));
    }

    projectEventBus.publish(projectId, {
      type: 'dispatch.done',
      batchId: batchRowId,
      handler: 'journal-record',
    });

    break;
  }
}
