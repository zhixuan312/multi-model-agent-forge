import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardJournal } from '@/journal/guard';
import { buildMmaClient } from '@/mma/server-client';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';
import { extractUsageFields } from '@/usage/extract-usage-fields';

export const maxDuration = 600;

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

    // When terminal, persist the envelope + usage columns on the ops_mma_batch row.
    if (result.state === 'terminal') {
      const db = getDb();
      const usage = extractUsageFields(result.envelope);
      await db
        .update(mmaBatch)
        .set({
          status: 'done',
          result: result.envelope as object,
          terminalAt: new Date(),
          ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
          ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
          ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
          ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
          ...(usage.implementerModel !== null && { implementerModel: usage.implementerModel }),
          ...(usage.reviewerModel !== null && { reviewerModel: usage.reviewerModel }),
          ...(usage.implementerTier !== null && { implementerTier: usage.implementerTier }),
        })
        .where(eq(mmaBatch.batchId, batchId))
        .catch(() => {});
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: 'Journal recall poll failed — MMA may be restarting.' },
      { status: 502 },
    );
  }
}
