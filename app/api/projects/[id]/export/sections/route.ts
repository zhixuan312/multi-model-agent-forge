import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { specSectionList } from '@/export/service';
import { parseExportKind, unknownKindResponse, mapExportError } from '@/export/route-helpers';

/**
 * `GET /api/projects/[id]/export/sections?artifact=spec` (Spec 8 F30) — the
 * `[{ NN, title }]` section list for the `ExportPdfDialog` checkboxes. Runs the
 * server-side `sections.ts` split so the dialog never re-parses `body_md`. Only
 * `spec` is component-structured; other kinds return an empty list.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const kindRaw = req.nextUrl.searchParams.get('artifact');
  const kind = parseExportKind(kindRaw);
  if (!kind) return unknownKindResponse();

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (kind !== 'spec') return NextResponse.json({ sections: [] });

  try {
    const sections = await specSectionList(id, { id: me.id, teamId: me.teamId! });
    return NextResponse.json({ sections });
  } catch (e) {
    const mapped = mapExportError(e);
    if (mapped) return mapped;
    throw e;
  }
}
