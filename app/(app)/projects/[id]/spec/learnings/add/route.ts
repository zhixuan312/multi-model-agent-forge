import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { addLearning, loadLearnings } from '@/spec/learnings';
import { LEARNING_TYPE } from '@/db/enums';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  bodyMd: z.string().trim().min(1, 'A learning is required.'),
  type: z.enum(LEARNING_TYPE),
});

/** `POST …/spec/learnings/add` — add a member-authored candidate (kept). */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();
  await addLearning(id, parsed.data, guard.memberId, { db });
  return NextResponse.json({ candidates: await loadLearnings(db, id) });
}
