import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { exportBundle } from '@/export/service';
import { mapExportError } from '@/export/route-helpers';

/**
 * `POST /api/projects/[id]/export/bundle` (Spec 8 Key flow D) — collects every
 * ready artifact's `.md` + one combined PDF into a `.zip` and STREAMS it
 * (`application/zip`, no `Content-Length`). Records `export(format='bundle',
 * artifact_id=null)` + action_log. Pending artifacts are silently omitted; the
 * `x-bundle-included` header names what was included (drives the toast).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ mermaidAsDiagram: z.boolean().default(true) }).default({ mermaidAsDiagram: true });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const mermaidAsDiagram = parsed.success ? parsed.data.mermaidAsDiagram : true;

  try {
    const { fileName, zip, includedKinds } = await exportBundle(id, { mermaidAsDiagram }, { id: me.id, teamId: me.teamId! });
    // Stream the zip body — no Content-Length (chunked).
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(zip));
        controller.close();
      },
    });
    return new NextResponse(stream, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${fileName}"`,
        'x-bundle-included': includedKinds.join(','),
      },
    });
  } catch (e) {
    const mapped = mapExportError(e);
    if (mapped) return mapped;
    throw e;
  }
}
