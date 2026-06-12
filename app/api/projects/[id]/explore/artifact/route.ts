import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { latestExplorationArtifact } from '@/exploration/explore-core';
import { USE_MOCK } from '@/mock/config';
import { getMockArtifact } from '@/mock/domains/projects/explore-tasks';

/** `GET /api/projects/[id]/explore/artifact` — the latest synthesized
 *  `artifact(kind='exploration')` (the summary pane refetch target). */
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (USE_MOCK) return NextResponse.json(getMockArtifact(id));
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }
  const a = await latestExplorationArtifact(id);
  if (!a) return NextResponse.json(null);
  return NextResponse.json(a);
}
