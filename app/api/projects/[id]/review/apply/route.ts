import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
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
import { execFileSync } from 'node:child_process';

export const runtime = 'nodejs';

const bodySchema = z.object({
  passNo: z.number().int().positive(),
  findingIndices: z.array(z.number().int().nonnegative()).min(1),
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

  const json = await _req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'passNo + findingIndices required' }, { status: 400 });
  const { passNo, findingIndices } = parsed.data;

  const db = getDb();

  // Find the review batch for this pass
  const reviewBatches = await db
    .select({ id: mmaBatch.id, result: mmaBatch.result, targetRepoId: mmaBatch.targetRepoId, cwd: mmaBatch.cwd })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  const passBatch = reviewBatches[passNo - 1];
  if (!passBatch) return NextResponse.json({ error: `Pass ${passNo} not found` }, { status: 404 });

  // Extract findings from the batch result
  const env = passBatch.result as Record<string, unknown> | null;
  const output = (env?.output ?? {}) as Record<string, unknown>;
  let summary = output.summary;
  if (typeof summary === 'string') {
    try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch {}
  }
  const allFindings = (summary as Record<string, unknown>)?.findings;
  if (!Array.isArray(allFindings)) return NextResponse.json({ error: 'No findings in pass result' }, { status: 400 });

  // Build the prompt with selected findings
  const selected = findingIndices.map((i) => allFindings[i]).filter(Boolean) as Array<Record<string, unknown>>;
  if (selected.length === 0) return NextResponse.json({ error: 'No valid findings selected' }, { status: 400 });

  const prompt = [
    'Apply the following code review fixes. Each fix is independent but some may touch the same file — resolve coherently.',
    '',
    ...selected.map((f, i) => {
      const parts = [`${i + 1}. [${f.weight}] ${f.file ?? ''}${f.line ? ':' + f.line : ''}`];
      if (f.claim) parts.push(`   Claim: ${f.claim}`);
      if (f.suggestion) parts.push(`   Fix: ${f.suggestion}`);
      return parts.join('\n');
    }),
    '',
    'After applying all fixes, verify the code compiles and tests pass.',
  ].join('\n');

  // Dispatch delegate with complex tier
  const mma = await buildMmaClient();
  const cwd = passBatch.cwd;

  let batchId: string;
  try {
    ({ batchId } = await mma.dispatch('delegate', {
      cwd,
      body: {
        type: 'delegate',
        prompt,
        agentTier: 'complex',
        reviewPolicy: 'none',
      },
    }));
  } catch (err) {
    return NextResponse.json({ error: `MMA dispatch failed: ${(err as Error).message}` }, { status: 502 });
  }

  const [batchRow] = await db
    .insert(mmaBatch)
    .values({
      projectId: id,
      route: 'delegate',
      handler: 'review-apply',
      cwd,
      batchId,
      status: 'dispatched',
      targetRepoId: passBatch.targetRepoId,
      request: { passNo, findingIndices, findingsCount: selected.length },
      dispatchedBy: me.id,
    })
    .returning({ id: mmaBatch.id });

  // Background poll
  pollApply(mma, db, batchId, batchRow.id, id, passBatch.targetRepoId ?? '', cwd).catch((err) => {
    projectEventBus.publish(id, { type: 'dispatch.failed', batchId: batchRow.id, handler: 'review-apply', error: (err as Error).message });
  });

  return NextResponse.json({ batchId: batchRow.id }, { status: 202 });
}

async function pollApply(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
  repoId: string,
  cwd: string,
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await mma.poll(mmaBatchId);
    if (res.state === 'pending') {
      await db.update(mmaBatch).set({ status: 'running' }).where(eq(mmaBatch.id, batchRowId));
      projectEventBus.publish(projectId, {
        type: 'dispatch.progress', batchId: batchRowId, handler: 'review-apply',
        phase: res.phase ?? 'running', elapsedMs: res.elapsedMs ?? 0,
      });
      continue;
    }
    if (res.state === 'not_found') {
      throw new Error('MMA task no longer exists — the server may have restarted.');
    }
    const envelope = res.envelope as Record<string, unknown> | null;
    const isFlatError = envelope && typeof envelope.code === 'string' && !envelope.task;
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

    // Push forge branch after successful fix
    if (!error) {
      try {
        const branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
        if (branch.startsWith('forge/')) {
          execFileSync('git', ['-C', cwd, 'push', 'origin', branch, '--force'], { timeout: 60_000 });
        }
      } catch (pushErr) {
        console.error(`[forge] push after review-apply failed:`, pushErr);
      }
    }

    projectEventBus.publish(projectId, {
      type: error ? 'dispatch.failed' : 'dispatch.done',
      batchId: batchRowId,
      handler: 'review-apply',
      ...(error ? { error: error.message } : {}),
    } as any);
    break;
  }
}
