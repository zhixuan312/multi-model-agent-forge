import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';

export const runtime = 'nodejs';

const bodySchema = z.object({
  learningIndex: z.number().int().min(0),
  action: z.enum(['approve', 'revoke']),
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
  const { learningIndex, action } = parsed.data;

  const db = getDb();
  await updateDetails(db, id, (d) => {
    const learning = d.stages.journal.phases.journal.learnings[learningIndex];
    if (learning) {
      learning.status = action === 'approve' ? 'kept' : 'proposed';
    }
    return d;
  });

  return NextResponse.json({ ok: true });
}
