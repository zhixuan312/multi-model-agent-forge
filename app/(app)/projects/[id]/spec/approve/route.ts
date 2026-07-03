import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';
import { currentMember } from '@/auth/current-member';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const db = getDb();

  if (body.action === 'revoke') {
    await updateDetails(db, id, (d) => {
      d.stages.spec.participants = d.stages.spec.participants.filter((p) => p !== me.id);
      return d;
    });
  } else {
    await updateDetails(db, id, (d) => {
      if (!d.stages.spec.participants.includes(me.id)) {
        d.stages.spec.participants.push(me.id);
      }
      return d;
    });
  }

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
