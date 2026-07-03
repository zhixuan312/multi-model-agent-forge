import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { insertNotification } from '@/collab/notification-store';
import { currentMember } from '@/auth/current-member';
import { validateDetails } from '@/details/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id, taskId } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { memberId } = (await req.json()) as { memberId: string };
  const db = getDb();

  // Find task title from details
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!projRow?.details) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const d = validateDetails(projRow.details);
  const task = d.stages.plan.phases.refine.tasks.find((t) => t.id === taskId);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  await insertNotification({
    memberId,
    kind: 'section_invite',
    title: `${me.displayName} invited you to review a plan task`,
    subtitle: `Plan · ${task.title}`,
    sourceId: `plan-invite:${taskId}:${memberId}`,
  }, db);

  return NextResponse.json({ ok: true });
}
