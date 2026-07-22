import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { member } from '@/db/schema/identity';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { insertNotification } from '@/collab/notification-store';
import { guardSpecWrite } from '@/spec/handler-guard';
import { teamSpecTemplate } from '@/db/schema/team';
import { projectEventBus } from '@/sse/event-bus';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // CSRF + auth + tenant scope — this route was reachable by any authed member against any
  // team's project, injecting participants and spamming notifications to arbitrary member ids.
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;

  const body = (await req.json().catch(() => ({}))) as { memberId?: unknown; componentId?: unknown };
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  const componentId = typeof body.componentId === 'string' ? body.componentId : '';
  if (!memberId || !componentId) return NextResponse.json({ error: 'memberId and componentId are required' }, { status: 400 });
  const db = getDb();

  // The invitee must be a real member of the caller's team — otherwise this is a notification
  // sink for arbitrary ids.
  const [invitee] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.teamId, me.teamId ?? '')))
    .limit(1);
  if (!invitee) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  const [projRow] = await db
    .select({ name: project.name, details: project.details })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!projRow?.details) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const d = validateDetails(projRow.details);
  const detailsComp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
  if (!detailsComp) return NextResponse.json({ error: 'Component not found' }, { status: 404 });

  // Add both members to spec-level participants
  await updateDetails(db, id, (d) => {
    if (!d.stages.spec.participants.includes(me.id)) {
      d.stages.spec.participants.push(me.id);
    }
    if (!d.stages.spec.participants.includes(memberId)) {
      d.stages.spec.participants.push(memberId);
    }
    return d;
  });

  const [tpl] = await db.select({ label: teamSpecTemplate.label }).from(teamSpecTemplate).where(eq(teamSpecTemplate.id, detailsComp.templateId)).limit(1);
  const compLabel = tpl?.label ?? 'Component';

  await insertNotification({
    memberId,
    kind: 'section_invite',
    title: `${me.displayName} invited you to review ${compLabel}`,
    subtitle: `${projRow?.name ?? 'Project'} · Spec · Craft`,
    sourceId: `invite:${componentId}:${memberId}`,
  }, db);

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
