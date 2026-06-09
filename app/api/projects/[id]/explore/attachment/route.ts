import { NextResponse, type NextRequest } from 'next/server';
import { guardExploreWrite } from '@/exploration/guard';
import { addLink, addUpload, AttachmentRejectError } from '@/exploration/attachments';

/** `POST /api/projects/[id]/explore/attachment` — add a brief input.
 *  `multipart/form-data` for image/file (bytes + label; server-generated path);
 *  `application/json {label,url}` for link. Allow-list + caps + traversal/symlink
 *  checks are enforced before insert. */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const json = await req.json().catch(() => null);
      const view = await addLink(id, json, { id: guard.memberId });
      return NextResponse.json(view);
    }
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const kindRaw = form.get('kind');
      const label = form.get('label');
      const file = form.get('file');
      if (kindRaw !== 'image' && kindRaw !== 'file') {
        return NextResponse.json({ error: 'kind must be image or file.' }, { status: 400 });
      }
      if (typeof label !== 'string' || !(file instanceof Blob)) {
        return NextResponse.json({ error: 'Missing label or file.' }, { status: 400 });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const view = await addUpload(id, { kind: kindRaw, label, bytes, mime: file.type }, { id: guard.memberId });
      return NextResponse.json(view);
    }
    return NextResponse.json({ error: 'Unsupported content type.' }, { status: 415 });
  } catch (err) {
    if (err instanceof AttachmentRejectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
