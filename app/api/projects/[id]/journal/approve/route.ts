import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';

export const runtime = 'nodejs';

const bodySchema = z.object({
  learningId: z.string().min(1),
  action: z.enum(['approve', 'revoke']),
  text: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { learningId, action, text } = parsed.data;

  const db = getDb();
  const update: { status: 'kept' | 'proposed'; bodyMd?: string } = {
    status: action === 'approve' ? 'kept' : 'proposed',
  };
  if (action === 'approve' && text !== undefined) update.bodyMd = text;

  await db
    .update(learningCandidate)
    .set(update)
    .where(and(eq(learningCandidate.id, learningId), eq(learningCandidate.projectId, id)));

  return NextResponse.json({ ok: true });
}
