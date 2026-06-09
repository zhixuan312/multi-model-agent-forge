import { NextResponse, type NextRequest } from 'next/server';
import { onHumanSatisfied } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite, buildAnthropic } from '@/spec/handler-guard';
import { getDb } from '@/db/client';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

/**
 * `POST …/sections/[sectionId]/nod` — the human "Looks good" nod (F29). The dual
 * gate is enforced in `onHumanSatisfied`: approve iff ai_satisfied (set by the
 * model); human_satisfied alone does NOT approve. No opus call is made here, but
 * the AnthropicClient is built lazily only if a re-draft were needed (it isn't).
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;
  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  try {
    const anthropic = await buildAnthropic();
    await onHumanSatisfied({ anthropic }, sectionId);
  } catch (e) {
    if (e instanceof Error && e.message === 'Cannot nod a section with no draft.') {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
