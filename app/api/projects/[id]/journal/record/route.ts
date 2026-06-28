import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { parseTags } from '@/journal/journal-core';
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

  const kept = await db.select({ id: learningCandidate.id, bodyMd: learningCandidate.bodyMd })
    .from(learningCandidate)
    .where(and(eq(learningCandidate.projectId, id), eq(learningCandidate.status, 'kept')));

  if (kept.length === 0) {
    return NextResponse.json({ error: 'No kept learnings to record' }, { status: 400 });
  }

  const lines = kept.map((l) => {
    const { category, source, text } = parseTags(l.bodyMd);
    return `- id=${l.id} | category=${category ?? 'insight'} | source=${source ?? 'Manual'} | ${text}`;
  });

  const prompt = `Role: You are the journal recorder for Forge, a software delivery harness.

Task: Record the following approved learnings to the team journal at .mma/journal/.

Context: These learnings were harvested from a completed project run and curated by the team. Each learning has a category, source stage, and text.

Input:

${lines.join('\n')}

Constraints:
- Record each learning as a separate journal entry
- Preserve the category and source metadata
- Use the journal's native format

Output format:
Write each learning to .mma/journal/ using the journal_record tool.`;

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'journal_record',
    handler: 'journal-record',
    cwd: resolveWorkspaceRoot(),
    body: { prompt },
    actorId: me.id,
    meta: { learningIds: kept.map((l) => l.id), learningCount: kept.length },
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
