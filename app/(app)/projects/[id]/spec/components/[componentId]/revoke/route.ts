import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { component } from '@/db/schema/spec';
import { participant } from '@/db/schema/participants';
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

  await db.delete(participant).where(
    and(
      eq(participant.scopeId, componentId),
      eq(participant.memberId, me.id),
      eq(participant.scope, 'component'),
      eq(participant.role, 'approver'),
    ),
  );

  const remaining = await db
    .select({ memberId: participant.memberId })
    .from(participant)
    .where(and(eq(participant.scopeId, componentId), eq(participant.scope, 'component'), eq(participant.role, 'approver')));

  await db
    .update(component)
    .set({
      status: remaining.length > 0 ? 'approved' : 'drafted',
      humanSatisfied: remaining.length > 0,
      updatedAt: new Date(),
    })
    .where(eq(component.id, componentId));

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
