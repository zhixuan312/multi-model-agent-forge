import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { loadOutline } from '@/spec/spec-core';
import { getDb } from '@/db/client';
import { stage } from '@/db/schema/projects';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }
  const db = getDb();
  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) return NextResponse.json({ components: [] });
  return NextResponse.json({ components: await loadOutline(db, specStage.id) });
}
