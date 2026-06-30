import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardExploreWrite } from '@/exploration/guard';
import { saveBrief, briefSchema } from '@/exploration/explore-core';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';

/** `POST /api/projects/[id]/explore/brief` — save the brain-dump to project.brief_md + intent_md. */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => null);
  const parsed = briefSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid brief.' }, { status: 400 });

  await saveBrief(id, parsed.data.text, { id: guard.memberId });
  await getDb().update(project).set({ intentMd: parsed.data.text, updatedAt: new Date() }).where(eq(project.id, id));
  return NextResponse.json({ ok: true });
}
