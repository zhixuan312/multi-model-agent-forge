import { NextResponse, type NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildLearningsPrompt } from '@/spec/learnings';
import { learningCandidate } from '@/db/schema/artifacts';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  // Idempotent: if candidates exist, return them without re-proposing
  const existing = await db
    .select()
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, id))
    .orderBy(asc(learningCandidate.createdAt));
  if (existing.length > 0) {
    return NextResponse.json({ candidates: existing });
  }

  const inflight = await findInflight(db, id, 'spec-learnings');
  if (inflight) {
    return NextResponse.json({ batchId: inflight, status: 'already_running' }, { status: 202 });
  }

  const { system, user } = await buildLearningsPrompt(db, id);

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'spec-learnings',
    cwd: resolveWorkspaceRoot(),
    body: { prompt: `${system}\n\n${user}` },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
