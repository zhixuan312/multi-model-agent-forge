import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { guardExploreWrite } from '@/exploration/guard';
import { addTask, readRailTasks, TaskLockedError } from '@/exploration/explore-core';

/** `GET` — the rail task list (joined to mma_batch); `POST` — add a draft task. */
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }
  return NextResponse.json(await readRailTasks(id));
}

const addSchema = z.object({
  kind: z.enum(['investigate', 'research', 'journal']),
  targetRepoId: z.string().uuid().nullable().optional(),
  prompt: z.string(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid task.' }, { status: 400 });

  try {
    const res = await addTask(id, parsed.data, { id: guard.memberId });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof TaskLockedError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
