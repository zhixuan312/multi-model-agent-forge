import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { onHumanSatisfied } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { projectEventBus } from '@/sse/event-bus';
import { componentSection, component } from '@/db/schema/spec';
import { currentMember } from '@/auth/current-member';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const me = await currentMember();

  try {
    await onHumanSatisfied({}, sectionId);
  } catch (e) {
    if (e instanceof Error && e.message === 'Cannot nod a section with no draft.') {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  if (me) {
    const db = getDb();
    const [sec] = await db
      .select({ componentId: componentSection.componentId })
      .from(componentSection)
      .where(eq(componentSection.id, sectionId))
      .limit(1);
    if (sec) {
      const [comp] = await db
        .select({ participants: component.participants })
        .from(component)
        .where(eq(component.id, sec.componentId))
        .limit(1);
      const existing = (comp?.participants as string[] | null) ?? [];
      const updated = existing.includes(me.id) ? existing : [...existing, me.id];
      await db
        .update(component)
        .set({ approvedBy: me.id, participants: updated as unknown as object })
        .where(eq(component.id, sec.componentId));
    }
  }

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
