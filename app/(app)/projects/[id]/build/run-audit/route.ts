import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { planFilePath } from '@/projects/project-files';
import { validateDetails } from '@/details/schema';
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

  // Get repos from details
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!projRow?.details) return NextResponse.json({ error: 'No project details.' }, { status: 409 });
  const d = validateDetails(projRow.details);

  if (d.repos.length === 0 || d.stages.plan.phases.refine.tasks.length === 0) {
    return NextResponse.json({ error: 'No plan tasks found.' }, { status: 409 });
  }

  const r = d.repos[0];
  const mma = await buildMmaClient({ db });
  const filePath = planFilePath(id);

  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'audit',
    handler: 'plan-audit',
    cwd: r.pathOnDisk,
    body: { subtype: 'plan', target: { paths: [filePath] } },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
