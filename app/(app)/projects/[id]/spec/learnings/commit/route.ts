import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { allCandidates } from '@/spec/learnings';
import { buildRecordPrompt } from '@/journal/record-prompt';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  try {
    const mma = await buildMmaClient({ db });
    const prompt = await buildRecordPrompt(id, db);
    await dispatchMma({
      db, mma, projectId: id, route: 'journal_record', handler: 'journal-record',
      cwd: resolveWorkspaceRoot(),
      body: { prompt },
      actorId: guard.memberId,
      await: true,
    });
    return NextResponse.json({ candidates: await allCandidates(id, { db }) });
  } catch {
    return NextResponse.json(
      { error: 'The journal write could not be completed — try again.', retryable: true },
      { status: 502 },
    );
  }
}
