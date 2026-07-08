import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { exportPdf } from '@/export/service';
import { parseExportKind, unknownKindResponse, mapExportError } from '@/export/route-helpers';

/**
 * `POST /api/projects/[id]/export/pdf` (Spec 8 Key flow C) — renders the
 * Forge-template PDF (two-pass TOC + in-page Mermaid) and streams it. Records
 * `export(format='pdf')` + action_log. Node runtime (Puppeteer).
 *
 * Body: { artifact, includeComponents?: string[] (NN keys), mermaidAsDiagram }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  artifact: z.string(),
  includeComponents: z.array(z.string()).optional(),
  mermaidAsDiagram: z.boolean().default(true),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const kind = parseExportKind(parsed.data.artifact);
  if (!kind) return unknownKindResponse();

  try {
    const { fileName, buffer } = await exportPdf(
      id,
      kind,
      { includeComponents: parsed.data.includeComponents, mermaidAsDiagram: parsed.data.mermaidAsDiagram },
      { id: me.id, teamId: me.teamId! },
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
