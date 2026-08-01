import { NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { getPollManager } from '@/sse/poll-manager';
import { buildMmaClient } from '@/mma/server-client';
import { projectEventBus } from '@/sse/event-bus';
import { pushDispatchFailure } from '@/collab/notification-store';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // Auth + tenant scope FIRST (before any DB access). This handler mutates state (fails stale
  // batches, pushes notifications, publishes to the project bus), yet had NO auth — any
  // cookie-bearing request could probe and force-fail any project's batches. Gate it like every
  // other project route.
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actor = projectActorFromMember(me);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  try {
    await assertProjectReadable(id, actor, { db });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    throw e;
  }

  const rows = await db
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, handler: mmaBatch.handler, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), inArray(mmaBatch.status, ['dispatched', 'running'])));

  const pm = getPollManager();
  const alive: string[] = [];

  // Both of these are loop-invariant: `id` is the route param, so the project row is the
  // same on every iteration, and the MMA client reads the same connection settings each
  // time. They were rebuilt per pending batch. The client stays LAZY (built on first
  // actual need, inside the try) so a connection failure still fails only the row that
  // needed it, exactly as before, rather than the whole request.
  const [proj] = await db
    .select({ name: project.name, ownerId: project.ownerId })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  let mmaClient: Awaited<ReturnType<typeof buildMmaClient>> | null = null;

  for (const row of rows) {
    if (!row.handler) continue;
    if (!row.batchId) { alive.push(row.handler); continue; }

    if (pm.isRegistered(row.id)) {
      alive.push(row.handler);
      continue;
    }

    try {
      mmaClient ??= await buildMmaClient({ db });
      const probe = await mmaClient.poll(row.batchId);
      if (probe.state === 'not_found') {
        await db
          .update(mmaBatch)
          .set({ status: 'failed', result: { error: { code: 'task_not_found', message: 'MMA task no longer exists — server restarted.' } } as object, terminalAt: new Date() })
          .where(eq(mmaBatch.id, row.id));
        await pushDispatchFailure({ projectId: id, projectName: proj?.name ?? '', ownerId: proj?.ownerId ?? null, handler: row.handler, batchId: row.id }, db);
        projectEventBus.publish(id, {
          type: 'dispatch.failed',
          batchId: row.id,
          handler: row.handler,
          error: 'MMA task no longer exists — server restarted.',
        });
        continue;
      }
      pm.register({
        batchId: row.id,
        mmaBatchId: row.batchId,
        projectId: id,
        route: 'orchestrate',
        taskId: null,
        handler: row.handler,
        createdAt: row.createdAt,
      });
      alive.push(row.handler);
    } catch {
      alive.push(row.handler);
    }
  }

  return NextResponse.json({ handlers: alive });
}
