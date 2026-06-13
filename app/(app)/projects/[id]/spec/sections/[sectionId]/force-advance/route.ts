import { NextResponse, type NextRequest } from 'next/server';
import { forceAdvance } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite, buildAnthropic, anthropicErrorResponse } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { USE_MOCK } from '@/mock/config';
import { forceMock } from '@/mock/domains/projects/spec';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

/** `POST …/sections/[sectionId]/force-advance` — human overrides the AI (F29). */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;

  if (USE_MOCK) return NextResponse.json(forceMock(id, sectionId));

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  try {
    const anthropic = await buildAnthropic();
    await forceAdvance({ anthropic }, sectionId, guard.memberId);
  } catch (e) {
    return anthropicErrorResponse(e);
  }
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
