import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { guardJournal } from '@/journal/guard';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';

export const runtime = 'nodejs';

/**
 * `GET /api/journal/recall/[batchId]` — a pure READ of a recall batch's persisted
 * terminal state. The PollManager (registered by the async `dispatchMma`) is the SOLE
 * poller of MMA and the sole writer of the row's terminal envelope; this endpoint no
 * longer polls MMA itself (that was a second, racing poller). It authorizes the batch
 * against the requesting member and returns `{ state: 'pending' }` until the row is
 * terminal, then `{ state: 'terminal', envelope }`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: false });
  if (guard instanceof NextResponse) return guard;

  const { batchId } = await params;
  if (!batchId) {
    return NextResponse.json({ error: 'Missing batch id.' }, { status: 400 });
  }

  const db = getDb();
  // Authorize: the recall batch must belong to THIS member. A project-less row read
  // must not leak another member's recall — a non-owned or unknown batch is a 404.
  const [row] = await db
    .select({ status: mmaBatch.status, result: mmaBatch.result })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.batchId, batchId), eq(mmaBatch.dispatchedBy, guard.memberId)))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { state: 'not_found', error: 'Recall not found.' },
      { status: 404 },
    );
  }

  // Terminal (done or failed) → hand back the persisted envelope; the client reads
  // `envelope.error` to distinguish a failed recall. Otherwise still pending.
  if (row.status === 'done' || row.status === 'failed') {
    return NextResponse.json({ state: 'terminal', envelope: row.result ?? {} });
  }
  return NextResponse.json({ state: 'pending', headline: 'Recalling…' });
}
