import { NextResponse, type NextRequest } from 'next/server';
import { guardExploreWrite } from '@/exploration/guard';
import { synthesize } from '@/exploration/synthesize';

/** `POST /api/projects/[id]/explore/synthesize` — main-agent synthesis →
 *  `artifact(kind='exploration')`. Normally invoked by the SynthesisScheduler;
 *  this route is the member-facing "re-synthesize" affordance. */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const res = await synthesize(id, { id: guard.memberId });
  if (!res.ok) {
    return NextResponse.json({ error: 'Synthesis failed — prior version retained.', retryable: true }, { status: 502 });
  }
  return NextResponse.json({ artifactId: res.artifactId, version: res.version });
}
