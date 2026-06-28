import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getLatestSpec } from '@/spec/assemble';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { specFilePath } from '@/projects/project-files';
import { auditPass } from '@/db/schema/artifacts';
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

  // Delta mode: get contextBlockId from the latest audit pass (if any)
  const [lastPass] = await db
    .select({ contextBlockId: auditPass.contextBlockId })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, id), eq(auditPass.scope, 'spec')))
    .orderBy(desc(auditPass.passNo))
    .limit(1);

  const contextBlockIds = lastPass?.contextBlockId ? [lastPass.contextBlockId] : undefined;

  const workspaceRoot = resolveWorkspaceRoot();
  const specPath = specFilePath(id);

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
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
