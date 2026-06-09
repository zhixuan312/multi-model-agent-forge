import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { ARTIFACT_KIND, type ArtifactKind } from '@/db/enums';
import { downloadStageArtifact, ArtifactNotFoundError } from '@/build/export-download';
import { ProjectAccessError } from '@/projects/projects-core';

/**
 * `GET /api/projects/[id]/artifacts/[kind]/download` (Spec 7 §In-scope F8) —
 * streams the latest `artifact(kind)`'s `body_md` as a `text/markdown`
 * attachment, inserts one `export(format='md')` row, and enforces the Spec 3
 * private/public visibility rule (a private artifact → 404 for a non-member,
 * anti-enumeration). PDF/bundle are Spec 8.
 */
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<NextResponse> {
  const { id, kind } = await params;
  if (!(ARTIFACT_KIND as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'Unknown artifact kind' }, { status: 404 });
  }

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await downloadStageArtifact({ projectId: id, kind: kind as ArtifactKind, actor: { id: me.id } });
    return new NextResponse(result.bodyMd, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (e) {
    // Anti-enumeration: a visibility failure surfaces as 404 (never 403 on read).
    if (e instanceof ProjectAccessError || e instanceof ArtifactNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw e;
  }
}
