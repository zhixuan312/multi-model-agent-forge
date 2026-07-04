import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { buildMmaClient } from '@/mma/server-client';
import { findInflight } from '@/dispatch/dispatch-helpers';
import { startExecuteRun } from '@/build/start-execute-run';
import '@/dispatch/handler-registry';

export const runtime = 'nodejs';

const bodySchema = z.object({
  repos: z.array(z.object({ repoId: z.string(), targetBranch: z.string() })).default([]),
});

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

  const existing = await findInflight(db, id, 'execute-pipeline');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const json = await _req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const repoList = parsed.success && parsed.data.repos.length > 0 ? parsed.data.repos : undefined;

  // The manual "Run execution" button and the auto driver share this ONE core:
  // it sets up the project branch, dispatches execute_plan on it, and the
  // execute-pipeline handler pushes + opens the PR (project branch → target).
  const mma = await buildMmaClient({ db });
  let result;
  try {
    result = await startExecuteRun(db, mma, id, me.id, repoList);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  if (result.dispatched.length === 0) {
    return NextResponse.json({ error: 'All repos failed', errors: result.errors }, { status: 502 });
  }
  return NextResponse.json(
    {
      dispatched: result.dispatched.map((x) => ({ repoId: x.repoId, batchId: x.batchRowId })),
      ...(result.errors.length > 0 ? { errors: result.errors } : {}),
    },
    { status: 202 },
  );
}
