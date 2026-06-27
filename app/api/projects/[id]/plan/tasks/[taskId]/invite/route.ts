import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { insertNotification } from '@/collab/notification-store';
import { currentMember } from '@/auth/current-member';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id, taskId } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { memberId } = (await req.json()) as { memberId: string };
  const db = getDb();

  const [task] = await db
    .select({ title: planTask.title, participants: planTask.participants })
    .from(planTask)
    .where(eq(planTask.id, taskId))
    .limit(1);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const existing = (task.participants as string[] | null) ?? [];
  const updated = [...existing];
  if (!updated.includes(me.id)) updated.push(me.id);
  if (!updated.includes(memberId)) updated.push(memberId);
  if (updated.length !== existing.length) {
    await db
      .update(planTask)
      .set({ participants: updated as unknown as object, updatedAt: new Date() })
      .where(eq(planTask.id, taskId));
  }

  await insertNotification({
    memberId,
    kind: 'section_invite',
    title: `${me.displayName} invited you to review a plan task`,
    subtitle: `Plan · ${task.title}`,
    sourceId: `plan-invite:${taskId}:${memberId}`,
  }, db);

  return NextResponse.json({ ok: true });
}
