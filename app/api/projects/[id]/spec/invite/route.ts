import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { insertNotification } from '@/collab/notification-store';
import { currentMember } from '@/auth/current-member';
import { teamSpecTemplate } from '@/db/schema/team';
import { projectEventBus } from '@/sse/event-bus';
import type { ComponentKind } from '@/db/enums';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { memberId, componentId } = (await req.json()) as { memberId: string; componentId: string };
  const db = getDb();

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
