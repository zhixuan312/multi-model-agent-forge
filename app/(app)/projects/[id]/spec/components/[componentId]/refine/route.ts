import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardSpecWrite } from '@/spec/handler-guard';
import { buildRefineRequest } from '@/spec/auto-draft';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

const bodySchema = z.object({
  userAnswer: z.string().trim().min(1, 'An answer is required.'),
  history: z.array(z.object({
    role: z.enum(['forge', 'user']),
    text: z.string(),
  })).default([]),
});

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();

  const existing = await findInflight(db, id, 'spec-refine');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const request = await buildRefineRequest({
    db,
    componentId,
    userAnswer: parsed.data.userAnswer,
    history: parsed.data.history,
  });
  if ('error' in request) {
    return NextResponse.json({ error: request.error }, { status: 409 });
  }

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'spec-refine',
    cwd: resolveWorkspaceRoot(),
    body: {
      prompt: `${request.system}\n\n${request.user}`,
      componentId,
    },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
