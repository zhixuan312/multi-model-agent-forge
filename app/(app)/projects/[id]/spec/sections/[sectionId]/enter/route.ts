import { NextResponse, type NextRequest } from 'next/server';
import { enterSection } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite, buildAnthropic, anthropicErrorResponse } from '@/spec/handler-guard';
import { getDb } from '@/db/client';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

/** @deprecated Old per-section Q&A — replaced by auto-draft (Approach C). Not called from UI. */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;
  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  try {
    const anthropic = await buildAnthropic();
    await enterSection({ anthropic }, sectionId);
  } catch (e) {
    return anthropicErrorResponse(e);
  }
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
