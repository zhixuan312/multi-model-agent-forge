import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { planFilePath } from '@/build/plan-fs';
import '@/dispatch/handler-registry';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const existing = await findInflight(db, id, 'plan-audit');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const rows = await db
    .selectDistinct({ repoId: planTask.targetRepoId, name: repo.name, path: repo.pathOnDisk })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id));

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No plan tasks found.' }, { status: 409 });
  }

  const r = rows[0];
  const mma = await buildMmaClient({ db });
  const filePath = planFilePath(r.path, id);

  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'audit',
    handler: 'plan-audit',
    cwd: r.path,
    body: { subtype: 'plan', filePaths: [filePath] },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
