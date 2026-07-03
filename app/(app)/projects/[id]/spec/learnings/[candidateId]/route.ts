import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { setLearningStatus, allCandidates } from '@/spec/learnings';

type Ctx = { params: Promise<{ id: string; candidateId: string }> };

const bodySchema = z.object({ status: z.enum(['kept', 'removed']) });

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, candidateId } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const db = getDb();
  const index = parseInt(candidateId, 10);
  if (isNaN(index)) return NextResponse.json({ error: 'Invalid index.' }, { status: 400 });
  await setLearningStatus(id, index, parsed.data.status, { db });
  return NextResponse.json({ candidates: await allCandidates(id, { db }) });
}
