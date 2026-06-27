import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { component } from '@/db/schema/spec';
import { projectEventBus } from '@/sse/event-bus';
import { currentMember } from '@/auth/current-member';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const me = await currentMember();
  const db = getDb();

  const [comp] = await db.select({ approvedBy: component.approvedBy }).from(component).where(eq(component.id, componentId)).limit(1);
  const approvers = (comp?.approvedBy as string[] | null) ?? [];
  const updated = approvers.filter((a) => a !== me?.id);

  await db
    .update(component)
    .set({
      status: updated.length > 0 ? 'approved' : 'drafted',
      humanSatisfied: updated.length > 0,
      approvedBy: updated as unknown as object,
      updatedAt: new Date(),
    })
    .where(eq(component.id, componentId));

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
