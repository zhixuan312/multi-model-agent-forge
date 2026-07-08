import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { downloadStageArtifact, ArtifactNotFoundError } from '@/build/export-download';
import { ProjectAccessError } from '@/projects/projects-core';

const DOWNLOADABLE_KINDS = ['exploration', 'spec', 'plan', 'journal'] as const;
type DownloadableKind = (typeof DOWNLOADABLE_KINDS)[number];

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<NextResponse> {
  const { id, kind } = await params;
  if (!(DOWNLOADABLE_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'Unknown artifact kind' }, { status: 404 });
  }

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actor = projectActorFromMember(me);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await downloadStageArtifact({ projectId: id, kind: kind as DownloadableKind, actor });
    return new NextResponse(result.bodyMd, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (e) {
    if (e instanceof ProjectAccessError || e instanceof ArtifactNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw e;
  }
}
