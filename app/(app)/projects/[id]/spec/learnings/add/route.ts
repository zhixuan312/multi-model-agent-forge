import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { addLearning, allCandidates } from '@/spec/learnings';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  heading: z.string().trim().min(1, 'A learning is required.'),
  type: z.enum(['decision', 'insight']),
});

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();
  await addLearning(id, parsed.data, { db });
  return NextResponse.json({ candidates: await allCandidates(id, { db }) });
}
