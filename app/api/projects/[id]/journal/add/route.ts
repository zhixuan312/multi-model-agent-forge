import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().min(1),
  category: z.string().min(1),
  source: z.string().min(1),
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
  const { text, category } = parsed.data;

  const db = getDb();
  const TYPE_MAP: Record<string, 'decision' | 'insight'> = {
    decision: 'decision', design: 'decision', process: 'insight',
    behavior: 'insight', knowledge: 'insight', style: 'insight', challenge: 'insight',
  };

  let newIndex = -1;
  await updateDetails(db, id, (d) => {
    d.stages.journal.phases.journal.learnings.push({
      heading: text,
      type: TYPE_MAP[category.toLowerCase()] ?? 'insight',
      status: 'proposed',
    });
    newIndex = d.stages.journal.phases.journal.learnings.length - 1;
    return d;
  });

  return NextResponse.json({ id: `learning-${newIndex}`, index: newIndex });
}
