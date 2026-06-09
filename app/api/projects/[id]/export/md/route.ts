import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { exportMd } from '@/export/service';
import { parseExportKind, unknownKindResponse, mapExportError } from '@/export/route-helpers';

/**
 * `GET /api/projects/[id]/export/md?artifact=<kind>` (Spec 8 Key flow B) — streams
 * the artifact's faithful `body_md` (review: adapter-normalized) as a
 * `text/markdown` attachment. Records `export(format='md')` + action_log.
 * Chromium-independent — works even if the PDF engine is broken.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const kind = parseExportKind(req.nextUrl.searchParams.get('artifact'));
  if (!kind) return unknownKindResponse();

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { fileName, body } = await exportMd(id, kind, { id: me.id });
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    const mapped = mapExportError(e);
    if (mapped) return mapped;
    throw e;
  }
}
