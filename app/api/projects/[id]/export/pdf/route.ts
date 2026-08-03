import { NextResponse, type NextRequest } from 'next/server';
import { unauthorized } from '@/auth/api-responses';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { exportPdf } from '@/export/service';
import { parseExportKind, unknownKindResponse, mapExportError } from '@/export/route-helpers';

/**
 * `POST /api/projects/[id]/export/pdf` (Spec 8 Key flow C) — renders the
 * Forge-template PDF (two-pass TOC + in-page Mermaid) and streams it. Records
 * `project_export(format='pdf')`. Node runtime (Puppeteer).
 *
 * Body: { artifact, mermaidAsDiagram }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  artifact: z.string(),
  mermaidAsDiagram: z.boolean().default(true),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const { id } = await params;
  const me = await currentMember();
  if (!me) return unauthorized();
  const actor = projectActorFromMember(me);
  if (!actor) return unauthorized();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'The export request was malformed.' }, { status: 400 });

  const kind = parseExportKind(parsed.data.artifact);
  if (!kind) return unknownKindResponse();

  try {
    const { fileName, buffer } = await exportPdf(
      id,
      kind,
      { mermaidAsDiagram: parsed.data.mermaidAsDiagram },
      actor,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    const mapped = mapExportError(e);
    if (mapped) return mapped;
    throw e;
  }
}
