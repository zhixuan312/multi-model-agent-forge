import { NextResponse, type NextRequest } from 'next/server';
import { guardJournal } from '@/journal/guard';
import { buildMmaClient } from '@/mma/server-client';

/**
 * `GET /api/journal/recall/[batchId]` — server-side poll proxy for a recall
 * batch. The MMA bearer is server-only (never reaches the browser), so the
 * browser polls THIS auth-gated route, which forwards to MMA's `GET /batch/:id`
 * and returns either `{ state: 'pending', headline }` or
 * `{ state: 'terminal', envelope }`. A transport failure surfaces a retryable
 * error (502), never a crash.
 */
export const runtime = 'nodejs';

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

  let client;
  try {
    client = await buildMmaClient();
  } catch {
    return NextResponse.json({ error: 'MMA is not configured.' }, { status: 503 });
  }

  try {
    const result = await client.poll(batchId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: 'Journal recall poll failed — MMA may be restarting.' },
      { status: 502 },
    );
  }
}
