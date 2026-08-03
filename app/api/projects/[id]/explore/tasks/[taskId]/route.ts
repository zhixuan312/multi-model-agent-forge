import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardProjectWrite } from '@/auth/guard-project-write';
import {
  editTask,
  removeTask,
  TaskLockedError,
  TaskNotFoundError,
  PromptTooShortError,
} from '@/exploration/explore-core';

export const runtime = 'nodejs';

/**
 * A locked/absent task used to be a silent success — `editTask`/`removeTask` returned
 * details unchanged and this route replied `{ ok: true }`. They throw now, so the
 * three outcomes a caller can actually hit are mapped here.
 */
function mapTaskError(err: unknown): NextResponse | null {
  if (err instanceof TaskNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof TaskLockedError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof PromptTooShortError) return NextResponse.json({ error: err.message }, { status: 400 });
  return null;
}

const patchSchema = z.object({
  prompt: z.string().optional(),
  targetRepoId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id, taskId } = await params;

  const guard = await guardProjectWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid patch.' }, { status: 400 });

  try {
    await editTask(id, parseInt(taskId.replace('task-', ''), 10), parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mapped = mapTaskError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id, taskId } = await params;

  const guard = await guardProjectWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  try {
    await removeTask(id, parseInt(taskId.replace('task-', ''), 10));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mapped = mapTaskError(err);
    if (mapped) return mapped;
    throw err;
  }
}
