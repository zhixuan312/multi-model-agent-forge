import { NextResponse, type NextRequest } from 'next/server';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildSpecAuthoringRequest } from '@/spec/auto-draft';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveProjectWorkspaceRoot } from '@/projects/project-workspace';
import { specFilePath } from '@/projects/project-files';
import { getDb } from '@/db/client';
import '@/dispatch/handler-registry';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  const existing = await findInflight(db, id, 'spec-auto-draft');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const outputPath = await specFilePath(id, db);
  const request = await buildSpecAuthoringRequest({ db, projectId: id, outputPath });
  if ('error' in request) {
    return NextResponse.json({ ok: false, error: request.error }, { status: 409 });
  }

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'spec',
    handler: 'spec-auto-draft',
    cwd: await resolveProjectWorkspaceRoot(id, db),
    body: request,
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
