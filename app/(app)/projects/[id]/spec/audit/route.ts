import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getLatestSpec } from '@/spec/assemble';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  contextBlockIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

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

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'audit',
    handler: 'spec-audit',
    cwd: resolveWorkspaceRoot(),
    body: {
      subtype: 'spec',
      document: spec.bodyMd,
      ...(parsed.data.contextBlockIds?.length ? { contextBlockIds: parsed.data.contextBlockIds } : {}),
    },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
