import { NextResponse, type NextRequest } from 'next/server';
import { guardProjectRead } from '@/auth/guard-project-write';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { getPollManager } from '@/sse/poll-manager';
import { buildMmaClient } from '@/mma/server-client';
import { projectEventBus } from '@/sse/event-bus';
import { pushDispatchFailure } from '@/collab/notification-store';
import { INFLIGHT_MMA_STATUS } from '@/db/enums';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // Auth + tenant scope FIRST (before any DB access). This handler mutates state (fails stale
  // batches, pushes notifications, publishes to the project bus), yet had NO auth — any
  // cookie-bearing request could probe and force-fail any project's batches.
  //
  // `guardProjectRead`, so an unreadable project answers 404 like every sibling GET. This
  // alone returned 403, which told an authenticated cross-team probe that the id exists —
  // exactly what the others' anti-enumeration 404 is there to hide.
  //
  // A GET that MUTATES, so it takes the write guard's CSRF step explicitly.
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const gate = await guardProjectRead(id);
  if (gate instanceof Response) return gate;

  const db = getDb();

  const rows = await db
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, handler: mmaBatch.handler, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), inArray(mmaBatch.status, INFLIGHT_MMA_STATUS)));

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
