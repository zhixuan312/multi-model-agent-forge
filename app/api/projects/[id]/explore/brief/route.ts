import { NextResponse, type NextRequest } from 'next/server';
import { guardExploreWrite } from '@/exploration/guard';
import { saveBrief, briefSchema } from '@/exploration/explore-core';

/** `POST /api/projects/[id]/explore/brief` — save the brain-dump as an
 *  `artifact(kind='exploration_brief')` (re-save bumps version). */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = briefSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid brief.' }, { status: 400 });

  const { version } = await saveBrief(id, parsed.data.text, { id: guard.memberId });
  return NextResponse.json({ version });
}
