import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { component } from '@/db/schema/spec';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  await getDb()
    .update(component)
    .set({ status: 'drafted', humanSatisfied: false, approvedBy: null, updatedAt: new Date() })
    .where(eq(component.id, componentId));

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
