import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildLearningsPrompt } from '@/spec/learnings';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveProjectWorkspaceRoot } from '@/projects/project-workspace';
import { validateDetails } from '@/details/schema';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (projRow?.details) {
    const d = validateDetails(projRow.details);
    const learnings = d.stages.journal.phases.journal.learnings;
    if (learnings.length > 0) {
      return NextResponse.json({ candidates: learnings.map((l, i) => ({ id: `learning-${i}`, ...l })) });
    }
  }

  const inflight = await findInflight(db, id, 'spec-learnings');
  if (inflight) {
    return NextResponse.json({ batchId: inflight, status: 'already_running' }, { status: 202 });
  }

  const { system, user } = await buildLearningsPrompt(db, id);

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'spec-learnings',
    cwd: await resolveProjectWorkspaceRoot(id, db),
    body: { prompt: `${system}\n\n${user}` },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
