import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardJournal } from '@/journal/guard';
import { buildMmaClient } from '@/mma/server-client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { getDb } from '@/db/client';

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
  const existing = await findInflight(db, null, 'journal-recall', guard.memberId);
  if (existing) return NextResponse.json({ batchRowId: existing }, { status: 202 });

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
    const { batchRowId } = await dispatchMma({
      db,
      mma,
      projectId: null,
      route: 'journal_recall',
      handler: 'journal-recall',
      cwd: workspaceRoot,
      body: { prompt: query, reviewPolicy: 'none' },
      actorId: guard.memberId,
    });
    return NextResponse.json({ batchRowId }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: 'Journal recall unavailable — MMA may be restarting.' },
      { status: 503 },
    );
  }
}
