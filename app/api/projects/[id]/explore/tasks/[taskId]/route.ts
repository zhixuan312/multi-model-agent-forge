import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardExploreWrite } from '@/exploration/guard';
import { editTask, removeTask, TaskLockedError } from '@/exploration/explore-core';

/** `PATCH /…/explore/tasks/[taskId]` — edit a draft prompt/target.
 *  `DELETE` — remove a draft task. Both reject non-draft (locked) rows. */
export const runtime = 'nodejs';

const patchSchema = z.object({
  prompt: z.string().optional(),
  targetRepoId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id, taskId } = await params;
  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid patch.' }, { status: 400 });

  try {
    await editTask(id, taskId, parsed.data, { id: guard.memberId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TaskLockedError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id, taskId } = await params;
  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  try {
    await removeTask(id, taskId, { id: guard.memberId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TaskLockedError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
