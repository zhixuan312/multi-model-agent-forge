import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { member } from '@/db/schema/identity';
import { updateDetails } from '@/details/write';
import { insertNotification } from '@/collab/notification-store';
import { guardSpecWrite } from '@/spec/handler-guard';
import { validateDetails } from '@/details/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // CSRF + auth + tenant scope — same IDOR class as the spec invite route.
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { memberId?: unknown };
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
  const db = getDb();

  // The invitee must be a real member of the caller's team.
  const [invitee] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.teamId, me.teamId ?? '')))
    .limit(1);
  if (!invitee) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

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
