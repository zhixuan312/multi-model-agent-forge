import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { guardJournal } from '@/journal/guard';
import { buildMmaClient } from '@/mma/server-client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';

export const maxDuration = 600;

export const runtime = 'nodejs';

const bodySchema = z.object({ query: z.string() });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: true });
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A query is required.' }, { status: 400 });
  }
  const query = parsed.data.query.trim();
  if (query.length < 10) {
    return NextResponse.json({ error: 'Query must be at least 10 characters.' }, { status: 400 });
  }
  if (query.length > 4000) {
    return NextResponse.json({ error: 'Query must be at most 4000 characters.' }, { status: 400 });
  }

  const db = getDb();
  // Per-member single-flight (the sanctioned project-less guard): reuse an in-flight
  // recall for this member rather than dispatching a second MMA task. Return its
  // EXTERNAL batchId so the client polls the right row.
  const existing = await findInflight(db, null, 'journal-recall', guard.memberId);
  if (existing) {
    const [row] = await db.select({ batchId: mmaBatch.batchId }).from(mmaBatch).where(eq(mmaBatch.id, existing)).limit(1);
    if (row?.batchId) return NextResponse.json({ batchId: row.batchId }, { status: 202 });
    // In-flight row exists but its external id isn't written yet (a tiny dispatch race);
    // tell the client to retry rather than hand back a null id.
    return NextResponse.json({ error: 'Journal recall is starting — retry in a moment.' }, { status: 503 });
  }

  const workspaceRoot = resolveWorkspaceRoot();
  let mma;
  try {
    mma = await buildMmaClient();
  } catch {
    return NextResponse.json(
      { error: 'Journal recall unavailable — MMA is not configured.' },
      { status: 503 },
    );
  }

  try {
    // Fire-and-row-poll: no terminal handler (recall isn't resolver-gated); the
    // PollManager persists the terminal envelope onto the row and the client polls
    // the read-only row endpoint. `label` keeps the row traceable as 'journal-recall'.
    const { batchId } = await dispatchMma({
      db,
      mma,
      projectId: null,
      route: 'journal_recall',
      handler: null,
      label: 'journal-recall',
      cwd: workspaceRoot,
      body: { prompt: query, reviewPolicy: 'none' },
      actorId: guard.memberId,
    });
    // The client polls by EXTERNAL batchId. If it's somehow absent, do not hand back a
    // null id — surface a retryable 503 (AC: null batchId is never returned).
    if (!batchId) {
      return NextResponse.json({ error: 'Journal recall unavailable — MMA did not return a task id.' }, { status: 503 });
    }
    return NextResponse.json({ batchId }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: 'Journal recall unavailable — MMA may be restarting.' },
      { status: 503 },
    );
  }
}
