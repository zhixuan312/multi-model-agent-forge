import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { buildHarvestPrompt } from '@/journal/harvest-prompt';
import '@/dispatch/handler-registry';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const csrf = rejectCrossOrigin(_req);
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

  const existing = await findInflight(db, id, 'journal-harvest');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const prompt = await buildHarvestPrompt(id, db);

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'journal-harvest',
    cwd: resolveWorkspaceRoot(),
    body: { prompt, reviewPolicy: 'none' },
    actorId: me.id,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
