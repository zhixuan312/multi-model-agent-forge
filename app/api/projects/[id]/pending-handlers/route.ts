import { NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { project } from '@/db/schema/projects';
import { getPollManager } from '@/sse/poll-manager';
import { buildMmaClient } from '@/mma/server-client';
import { projectEventBus } from '@/sse/event-bus';
import { pushDispatchFailure } from '@/collab/notification-store';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = getDb();

  const rows = await db
    .select({ id: mmaBatch.id, batchId: mmaBatch.batchId, handler: mmaBatch.handler, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), inArray(mmaBatch.status, ['dispatched', 'running'])));

  const pm = getPollManager();
  const alive: string[] = [];

  for (const row of rows) {
    if (!row.handler) continue;
    if (!row.batchId) { alive.push(row.handler); continue; }

    if (pm.isRegistered(row.id)) {
      alive.push(row.handler);
      continue;
    }

    try {
      const mma = await buildMmaClient({ db });
      const probe = await mma.poll(row.batchId);
      if (probe.state === 'not_found') {
        await db
          .update(mmaBatch)
          .set({ status: 'failed', result: { error: { code: 'task_not_found', message: 'MMA task no longer exists — server restarted.' } } as object, terminalAt: new Date() })
          .where(eq(mmaBatch.id, row.id));
        const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, id)).limit(1);
        await pushDispatchFailure({ projectId: id, projectName: proj?.name ?? '', handler: row.handler, batchId: row.id }, db);
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
