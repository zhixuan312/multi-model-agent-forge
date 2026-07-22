import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { updateDetails } from '@/details/write';
import { insertNotification } from '@/collab/notification-store';
import { currentMember } from '@/auth/current-member';
import { validateDetails } from '@/details/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { memberId } = (await req.json()) as { memberId: string };
  const db = getDb();

  const [projRow] = await db.select({ name: project.name, details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!projRow?.details) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  validateDetails(projRow.details); // guard: valid details

  // Plan reviewers are PLAN-LEVEL (invited once, may approve any task) — persist the member to
  // the plan participants and add the inviter, so the participant strip survives navigation.
  // A single notification (sourceId keyed only by member) instead of one per task.
  await updateDetails(db, id, (d) => {
    const p = d.stages.plan.participants;
    for (const mid of [me.id, memberId]) if (!p.includes(mid)) p.push(mid);
    return d;
  });

  await insertNotification({
    memberId,
    kind: 'section_invite',
    title: `${me.displayName} invited you to review the plan`,
    subtitle: `${projRow.name ?? 'Project'} · Plan`,
    sourceId: `plan-invite:${memberId}`,
  }, db);

  return NextResponse.json({ ok: true });
}
