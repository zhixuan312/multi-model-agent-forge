import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { advanceStage, assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';

export const runtime = 'nodejs';

const bodySchema = z.object({
  from: z.enum(['exploration', 'spec', 'plan', 'execute', 'review']),
});

export async function POST(
  req: NextRequest,
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

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const result = await advanceStage(id, parsed.data.from, { id: me.id });
  return NextResponse.json(result);
}
