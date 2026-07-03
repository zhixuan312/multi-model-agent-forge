import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { buildRecordPrompt } from '@/journal/record-prompt';
import { validateDetails } from '@/details/schema';
import '@/dispatch/handler-registry';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const db = getDb();

  const existing = await findInflight(db, id, 'journal-record');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!projRow?.details) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const d = validateDetails(projRow.details);
  const kept = d.stages.journal.phases.journal.learnings.filter((l) => l.status === 'kept');

  if (kept.length === 0) {
    return NextResponse.json({ error: 'No kept learnings to record' }, { status: 400 });
  }

  const prompt = await buildRecordPrompt(id, db);

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'journal_record',
    handler: 'journal-record',
    cwd: resolveWorkspaceRoot(),
    body: { prompt },
    actorId: me.id,
    meta: { learningCount: kept.length },
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
