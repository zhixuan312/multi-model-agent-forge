import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { collectMenu } from '@/export/collect-artifacts';
import { mapExportError } from '@/export/route-helpers';

/**
 * `GET /api/projects/[id]/export/artifacts` (Spec 8 Key flow A) — the `Export ▾`
 * menu model: one item per deliverable kind with ready/pending + the derived
 * locked·audited flag. Visibility-gated in `collect-artifacts` (403 for a
 * non-collaborator on a private project).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actor = projectActorFromMember(me);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const items = await collectMenu(id, actor);
    return NextResponse.json({ artifacts: items });
  } catch (e) {
    const mapped = mapExportError(e);
    if (mapped) return mapped;
    throw e;
  }
}
