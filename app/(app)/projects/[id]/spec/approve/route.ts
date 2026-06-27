import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { stage } from '@/db/schema/projects';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const db = getDb();

  const [row] = await db
    .select({ id: stage.id, approvers: stage.approvers })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Stage not found' }, { status: 404 });

  const approvers = (row.approvers as string[] | null) ?? [];

  if (body.action === 'revoke') {
    const updated = approvers.filter((a) => a !== me.id);
    await db.update(stage).set({ approvers: updated as unknown as object }).where(eq(stage.id, row.id));
  } else {
    if (!approvers.includes(me.id)) {
      const updated = [...approvers, me.id];
      await db.update(stage).set({ approvers: updated as unknown as object }).where(eq(stage.id, row.id));
    }
  }

  console.log('[Approve] publishing spec.updated, bus channels:', projectEventBus.channelCount(), 'listeners for project:', projectEventBus.listenerCount(id));
  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
