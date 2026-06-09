import { NextResponse, type NextRequest } from 'next/server';
import { guardExploreWrite } from '@/exploration/guard';
import { removeAttachment, AttachmentRejectError } from '@/exploration/attachments';

/** `DELETE /api/projects/[id]/explore/attachment/[attachmentId]` — unlink the
 *  on-disk byte (On-disk lifecycle) then delete the row. */
export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<NextResponse> {
  const { id, attachmentId } = await params;
  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  try {
    await removeAttachment(id, attachmentId, { id: guard.memberId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AttachmentRejectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
