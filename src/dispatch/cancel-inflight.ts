import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { getPollManager } from '@/sse/poll-manager';
import { INFLIGHT_MMA_STATUS } from '@/db/enums';

/**
 * Ask MMA to stop every batch still in flight for a project.
 *
 * Cancellation is COOPERATIVE (engine 5.16 `DELETE /task/:taskId`): this requests the stop
 * and returns: the batches stay `running` until the engine's runner confirms, and the
 * server-owned poll loop is what carries each to its terminal `cancelled` envelope. So the
 * count returned is "how many stops were requested", never "how many stopped".
 *
 * Used by `take_over`. Stopping automation used to release the driver lease and nothing
 * else, which left the engine working on the task it had already been given — still burning
 * tokens, and still committing to the project branch after a human had taken the wheel. The
 * per-batch HTTP route (`POST /projects/[id]/batches/[batchId]/cancel`) is the single-batch
 * form of the same `requestCancel` call, with its own auth gates and response mapping.
 *
 * Best-effort per batch: one failure must not prevent the rest being asked to stop, so each
 * request is caught. Callers use this for its effect, and it never throws.
 */
export async function cancelInFlightBatches(db: Db, projectId: string): Promise<number> {
  const rows = await db
    .select({ id: mmaBatch.id })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, projectId), inArray(mmaBatch.status, INFLIGHT_MMA_STATUS)));

  let requested = 0;
  for (const row of rows) {
    try {
      const outcome = await getPollManager().requestCancel(row.id);
      if (outcome.kind === 'requested' || outcome.kind === 'already_requested') requested += 1;
    } catch {
      // A batch the poll manager no longer tracks (sync dispatch, or one the engine has
      // already forgotten) is not cancellable and not an error for the caller.
    }
  }
  return requested;
}
