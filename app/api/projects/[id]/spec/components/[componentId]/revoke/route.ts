import { NextResponse, type NextRequest } from 'next/server';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';
import { projectEventBus } from '@/sse/event-bus';
import { currentMember } from '@/auth/current-member';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();

  await updateDetails(db, id, (d) => {
    const comp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
    if (comp) {
      comp.approvals = comp.approvals.filter((a) => a !== me.id);
    }
    return d;
  });

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
