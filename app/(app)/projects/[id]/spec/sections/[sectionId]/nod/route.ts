import { NextResponse, type NextRequest } from 'next/server';
import { onHumanSatisfied } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { projectEventBus } from '@/sse/event-bus';
import { currentMember } from '@/auth/current-member';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const me = await currentMember();

  // sectionId format is `{componentUUID}-{sectionKey}` — extract componentId
  const componentId = sectionId.length >= 36 ? sectionId.slice(0, 36) : sectionId;

  try {
    await onHumanSatisfied({}, componentId, me?.id);
  } catch (e) {
    if (e instanceof Error && e.message === 'Cannot nod a section with no draft.') {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
