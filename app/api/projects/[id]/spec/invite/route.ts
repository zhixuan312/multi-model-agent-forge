import { NextResponse, type NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { component } from '@/db/schema/spec';
import { insertNotification } from '@/collab/notification-store';
import { currentMember } from '@/auth/current-member';
import { templateForKind } from '@/spec/components';
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

  const [comp] = await db
    .select({ kind: component.kind, participants: component.participants })
    .from(component)
    .where(eq(component.id, componentId))
    .limit(1);
  if (!comp) return NextResponse.json({ error: 'Component not found' }, { status: 404 });

  // Add to participants array if not already there
  const existing = (comp.participants as string[] | null) ?? [];
  if (!existing.includes(memberId)) {
    await db
      .update(component)
      .set({ participants: [...existing, memberId] as unknown as object, updatedAt: new Date() })
      .where(eq(component.id, componentId));
  }

  const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, id)).limit(1);
  const compLabel = templateForKind(comp.kind as ComponentKind).label;

  await insertNotification({
    memberId,
    kind: 'section_invite',
    title: `${me.displayName} invited you to review ${compLabel}`,
    subtitle: `${proj?.name ?? 'Project'} · Spec · Craft`,
    sourceId: `invite:${componentId}:${memberId}`,
  }, db);

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
