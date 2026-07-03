import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getLatestSpec } from '@/spec/assemble';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { specFilePath } from '@/projects/project-files';
import { mmaBatch } from '@/db/schema/ops';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const existing = await findInflight(db, id, 'spec-audit');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const spec = await getLatestSpec(db, id);
  if (!spec) {
    return NextResponse.json(
      { error: 'Assemble the specification before auditing.' },
      { status: 409 },
    );
  }

  // Delta mode: get contextBlockId from the latest spec-audit mmaBatch result (if any)
  const [lastBatch] = await db
    .select({ result: mmaBatch.result })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.handler, 'spec-audit'), eq(mmaBatch.status, 'done')))
    .orderBy(desc(mmaBatch.createdAt))
    .limit(1);

  let contextBlockIds: string[] | undefined;
  if (lastBatch?.result) {
    const envelope = lastBatch.result as Record<string, unknown>;
    if (typeof envelope.contextBlockId === 'string') {
      contextBlockIds = [envelope.contextBlockId];
    }
  }

  const workspaceRoot = resolveWorkspaceRoot();
  const specPath = specFilePath(id);

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'audit',
    handler: 'spec-audit',
    cwd: workspaceRoot,
    body: {
      subtype: 'spec',
      target: { paths: [specPath] },
      ...(contextBlockIds ? { contextBlockIds } : {}),
    },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
