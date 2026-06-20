import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { taskId } = await ctx.params;
  const db = getDb();
  await db.update(planTask).set({ status: 'committed', updatedAt: new Date() }).where(eq(planTask.id, taskId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { taskId } = await ctx.params;
  const db = getDb();
  await db.update(planTask).set({ status: 'queued', updatedAt: new Date() }).where(eq(planTask.id, taskId));
  return NextResponse.json({ ok: true });
}
