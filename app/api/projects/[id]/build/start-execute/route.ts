import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { mmaBatch } from '@/db/schema/mma';
import { project, stage } from '@/db/schema/projects';
import { getLatestPlanArtifact } from '@/build/plan-author';
import { writePlanFile, nodePlanFs, planFilePath } from '@/build/plan-fs';
import { buildMmaClient } from '@/mma/server-client';
import { loadRepoMeta } from '@/build/orchestrator';
import { projectEventBus } from '@/sse/event-bus';
import { extractUsageFields } from '@/usage/extract-usage-fields';

/**
 * `POST /api/projects/[id]/build/start-execute` — dispatch ALL plan tasks to
 * MMA in a single `execute_plan` call. MMA handles worktree creation, sequential
 * task execution, review, merge, and cleanup. Forge just dispatches and polls.
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

  const tasks = await db
    .select({ id: planTask.id, title: planTask.title, orderIndex: planTask.orderIndex, targetRepoId: planTask.targetRepoId })
    .from(planTask)
    .where(eq(planTask.projectId, id))
    .orderBy(planTask.orderIndex);

  if (tasks.length === 0) {
    return NextResponse.json({ error: 'No plan tasks to execute.' }, { status: 400 });
  }

  const planArtifact = await getLatestPlanArtifact(db, id);
  if (!planArtifact?.bodyMd) {
    return NextResponse.json({ error: 'No plan artifact found.' }, { status: 400 });
  }

  const repos = await loadRepoMeta(db, id);
  if (repos.size === 0) {
    return NextResponse.json({ error: 'No repos associated with project.' }, { status: 400 });
  }

  // Write plan file to the first target repo (MMA reads it from disk)
  const firstRepoId = tasks[0].targetRepoId;
  const repoMeta = repos.get(firstRepoId);
  if (!repoMeta) {
    return NextResponse.json({ error: 'Target repo not found.' }, { status: 400 });
  }

  let planPath: string;
  try {
    planPath = await writePlanFile(nodePlanFs, repoMeta.pathOnDisk, id, planArtifact.bodyMd);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to write plan file: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Relative plan path (MMA resolves relative to cwd)
  const relativePlanPath = planFilePath(repoMeta.pathOnDisk, id).replace(repoMeta.pathOnDisk + '/', '');

  // Dispatch ONE execute_plan call with ALL task titles
  const mma = await buildMmaClient();
  let batchId: string;
  try {
    ({ batchId } = await mma.executePlan(repoMeta.pathOnDisk, {
      planPath: relativePlanPath,
      tasks: tasks.map((t) => t.title),
      reviewPolicy: 'reviewed',
    }));
  } catch (err) {
    return NextResponse.json(
      { error: `MMA dispatch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Record the batch in ops_mma_batch
  const [batchRow] = await db
    .insert(mmaBatch)
    .values({
      projectId: id,
      route: 'execute_plan',
      handler: 'execute-pipeline',
      cwd: repoMeta.pathOnDisk,
      batchId,
      status: 'dispatched',
      request: { planPath: relativePlanPath, tasks: tasks.map((t) => t.title), reviewPolicy: 'reviewed' },
      dispatchedBy: me.id,
    })
    .returning({ id: mmaBatch.id });

  // Mark all tasks as executing
  await db
    .update(planTask)
    .set({ status: 'executing', mmaBatchId: batchRow.id, updatedAt: new Date() })
    .where(eq(planTask.projectId, id));

  // Emit initial progress SSE
  projectEventBus.publish(id, {
    type: 'dispatch.progress',
    batchId: batchRow.id,
    handler: 'execute-pipeline',
    phase: 'implementing',
    elapsedMs: 0,
    totalTasks: tasks.length,
  });

  // Background: poll MMA until terminal, then update DB
  pollAndFinalize(mma, db, batchId, batchRow.id, id, tasks, repoMeta.name).catch((err) => {
    console.error(`[forge] execute poll failed for project ${id}:`, err);
    projectEventBus.publish(id, {
      type: 'dispatch.failed',
      batchId: batchRow.id,
      handler: 'execute-pipeline',
      error: (err as Error).message,
    });
  });

  return NextResponse.json({ ok: true, batchId: batchRow.id }, { status: 202 });
}

async function pollAndFinalize(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
  tasks: { id: string; title: string; orderIndex: number }[],
  repoName: string,
): Promise<void> {
  // Poll until terminal
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
      });
      continue;
    }

    // Terminal
    const envelope = res.envelope as Record<string, unknown> | null;
    const taskResult = (envelope?.task ?? {}) as Record<string, unknown>;
    const output = (envelope?.output ?? {}) as Record<string, unknown>;
    const execution = (envelope?.execution ?? {}) as Record<string, unknown>;
    const worktree = (execution.worktree ?? {}) as Record<string, unknown>;
    const error = envelope?.error as { code: string; message: string } | null;
    const usage = extractUsageFields(envelope);

    const succeeded = taskResult.status !== 'failed' && !error;
    const filesChanged = Array.isArray(output.filesChanged) ? output.filesChanged as string[] : [];

    // Update batch record
    await db.update(mmaBatch).set({
      status: succeeded ? 'done' : 'failed',
      result: envelope as object,
      terminalAt: new Date(),
      ...(usage.costUsd && { costUsd: usage.costUsd }),
      ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
      ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
      ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
    }).where(eq(mmaBatch.id, batchRowId));

    // Update task statuses
    if (succeeded) {
      await db.update(planTask).set({
        status: 'committed',
        branch: typeof worktree.branch === 'string' ? worktree.branch : null,
        updatedAt: new Date(),
      }).where(eq(planTask.projectId, projectId));

      for (const t of tasks) {
        projectEventBus.publish(projectId, {
          type: 'task.committed',
          taskId: t.id,
          commitSha: 'worktree-merged',
        });
      }
    } else {
      await db.update(planTask).set({
        status: 'failed',
        updatedAt: new Date(),
      }).where(eq(planTask.projectId, projectId));

      for (const t of tasks) {
        projectEventBus.publish(projectId, {
          type: 'build.task_failed',
          taskId: t.id,
          reason: error?.message ?? 'Execute plan failed',
        });
      }
    }

    // Emit dispatch.done SSE
    projectEventBus.publish(projectId, {
      type: 'dispatch.done',
      batchId: batchRowId,
      handler: 'execute-pipeline',
    });

    break;
  }
}
