import { NextResponse, type NextRequest } from 'next/server';
import { guardProjectRead } from '@/auth/guard-project-write';
import { z } from 'zod';
import { guardProjectWrite } from '@/auth/guard-project-write';
import { addTask, readRailTasks, PromptTooShortError } from '@/exploration/explore-core';

/** `GET` — the rail task list (joined to mma_batch); `POST` — add a draft task. */
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const gate = await guardProjectRead(id);
  if (gate instanceof Response) return gate;
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

  const guard = await guardProjectWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid task.' }, { status: 400 });

  try {
    const res = await addTask(id, parsed.data);
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof PromptTooShortError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
