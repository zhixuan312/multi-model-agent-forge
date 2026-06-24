import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardExploreWrite } from '@/exploration/guard';
import { buildProposeRequest } from '@/exploration/fan-out';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import { projectRepo } from '@/db/schema/projects';
import '@/dispatch/handler-registry';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const existing = await findInflight(db, id, 'explore-propose');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const request = await buildProposeRequest(id, { db });

  const repos = await db
    .select({ repoId: projectRepo.repoId })
    .from(projectRepo)
    .where(eq(projectRepo.projectId, id));
  const repoIds = repos.map((r) => r.repoId);

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'explore-propose',
    cwd: resolveWorkspaceRoot(),
    body: {
      prompt: `${request.system}\n\n${request.user}`,
      reviewPolicy: 'none',
    },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
