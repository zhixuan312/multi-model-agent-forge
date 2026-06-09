import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { commitLearnings, loadLearnings, JournalRecordIncompleteError } from '@/spec/learnings';
import { buildMmaClient } from '@/mma/server-client';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/spec/learnings/commit` — write the KEPT learnings to the team journal
 * via `journal-record` at `cwd`=workspace root, then stamp `recorded_node_id`.
 * A failed write (no node ids) is retryable; candidates stay `kept`.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  try {
    const mma = await buildMmaClient({ db });
    const result = await commitLearnings({ db, mma }, id, guard.memberId);
    return NextResponse.json({ recordedCount: result.recordedCount, candidates: await loadLearnings(db, id) });
  } catch (e) {
    if (e instanceof JournalRecordIncompleteError) {
      return NextResponse.json(
        { error: 'The journal write did not finish — try again.', retryable: true },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'The journal write could not be completed — try again.', retryable: true },
      { status: 502 },
    );
  }
}
