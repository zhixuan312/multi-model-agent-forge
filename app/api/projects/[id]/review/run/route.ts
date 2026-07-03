import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
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

  const existing = await findInflight(db, id, 'code-review');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const [projRow] = await db
    .select({ details: project.details })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!projRow?.details) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const d = validateDetails(projRow.details);
  const repos = d.repos;

  if (repos.length === 0) return NextResponse.json({ error: 'No repos' }, { status: 400 });

  // Get changed files from latest execute batch
  const [execBatch] = await db
    .select({ result: mmaBatch.result })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'execute_plan'), eq(mmaBatch.status, 'done')))
    .orderBy(desc(mmaBatch.createdAt))
    .limit(1);

  let changedFiles: string[] = [];
  if (execBatch?.result) {
    const env = execBatch.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    if (Array.isArray(output.filesChanged)) {
      changedFiles = output.filesChanged as string[];
    }
  }

  const mma = await buildMmaClient({ db });
  const dispatched: Array<{ repoId: string; batchId: string }> = [];

  for (const repoRow of repos) {
    try {
      const { batchRowId } = await dispatchMma({
        db,
        mma,
        projectId: id,
        route: 'review',
        handler: 'code-review',
        cwd: repoRow.pathOnDisk,
        body: {
          target: { paths: changedFiles.length > 0 ? changedFiles : ['.'] },
          prompt: 'Review all changed files for correctness, security, performance, cross-file ripple, test gaps, and style issues.',
        },
        actorId: me.id,
        meta: { repoId: repoRow.id },
      });
      dispatched.push({ repoId: repoRow.id, batchId: batchRowId });
    } catch (err) {
      console.error(`[forge] review dispatch failed for ${repoRow.name}:`, err);
    }
  }

  if (dispatched.length === 0) return NextResponse.json({ error: 'All repos failed' }, { status: 502 });
  return NextResponse.json({ dispatched }, { status: 202 });
}
