import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { participant } from '@/db/schema/participants';
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
    .select({ title: planTask.title })
    .from(planTask)
    .where(eq(planTask.id, taskId))
    .limit(1);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  await db
    .insert(participant)
    .values({ projectId: id, memberId: me.id, scope: 'task', scopeId: taskId, role: 'reviewer' })
    .onConflictDoNothing();
  await db
    .insert(participant)
    .values({ projectId: id, memberId, scope: 'task', scopeId: taskId, role: 'reviewer' })
    .onConflictDoNothing();

  await insertNotification({
    memberId,
    kind: 'section_invite',
    title: `${me.displayName} invited you to review a plan task`,
    subtitle: `Plan · ${task.title}`,
    sourceId: `plan-invite:${taskId}:${memberId}`,
  }, db);

  return NextResponse.json({ ok: true });
}
