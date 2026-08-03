import { NextResponse, type NextRequest } from 'next/server';
import { unauthorized } from '@/auth/api-responses';
import { and, eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { getPollManager } from '@/sse/poll-manager';

export const runtime = 'nodejs';

/**
 * `POST /api/projects/[id]/batches/[batchId]/cancel` — ask MMA to stop one running
 * batch (engine 5.16 `DELETE /task/:taskId`).
 *
 * Cancellation is COOPERATIVE, so a 202 means REQUESTED, not stopped: the batch stays
 * `running` until the engine's runner confirms, and the server-owned poll loop is what
 * carries it to the terminal `cancelled` envelope (persisted as batch status
 * `'cancelled'`, emitted as `task.cancelled`/`dispatch.cancelled`). Idempotent — a
 * repeat call is a 202 no-op, never an error.
 *
 * Auth is two gates, both required: the caller must be a team-scoped member who can
 * read this project (`assertProjectReadable`, which scopes by `actor.teamId`), AND the
 * batch must belong to that same project. Without the second gate a member of team A
 * could pass any batch id and stop team B's work.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> },
): Promise<NextResponse> {
  const { id, batchId } = await params;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return unauthorized();
  const actor = projectActorFromMember(me);
  if (!actor) return unauthorized();

  const db = getDb();
  try {
    await assertProjectReadable(id, actor, { db });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  // The batch must be THIS project's (anti-enumeration: a foreign batch is a 404, not a 403).
  const [row] = await db
    .select({ id: mmaBatch.id, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.id, batchId), eq(mmaBatch.projectId, id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (row.status !== 'dispatched' && row.status !== 'running') {
    return NextResponse.json({ batchId, state: 'already_terminal', status: row.status }, { status: 200 });
  }

  const outcome = await getPollManager().requestCancel(row.id);
  switch (outcome.kind) {
    case 'requested':
    case 'already_requested':
      return NextResponse.json({ batchId, state: outcome.kind, cancellationRequested: true }, { status: 202 });
    case 'already_terminal':
      return NextResponse.json({ batchId, state: 'already_terminal', status: outcome.status }, { status: 200 });
    case 'not_tracked':
      // The row says in-flight but nothing is polling it (a sync `await:true` dispatch,
      // or a batch the engine has already forgotten). There is nothing to cancel here;
      // report it rather than pretending the request landed.
      return NextResponse.json({ batchId, state: 'not_tracked' }, { status: 409 });
  }
}
