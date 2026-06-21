import { NextResponse, type NextRequest } from 'next/server';
import { onHumanSatisfied } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  try {
    await onHumanSatisfied({}, sectionId);
  } catch (e) {
    if (e instanceof Error && e.message === 'Cannot nod a section with no draft.') {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
