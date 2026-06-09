import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { onMemberAnswer } from '@/spec/orchestrator';
import { buildSectionRepaint } from '@/spec/spec-core';
import { guardSpecWrite, buildAnthropic, anthropicErrorResponse } from '@/spec/handler-guard';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

const bodySchema = z.object({ answerMd: z.string().trim().min(1, 'An answer is required.') });

/** `POST …/sections/[sectionId]/answer` — a member turn (F29). Repaints the section. */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, sectionId } = await ctx.params;
  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body.' }, { status: 400 });
  }

  try {
    const anthropic = await buildAnthropic();
    await onMemberAnswer({ anthropic }, sectionId, parsed.data.answerMd, guard.memberId);
  } catch (e) {
    return anthropicErrorResponse(e);
  }

  const { getDb } = await import('@/db/client');
  return NextResponse.json(await buildSectionRepaint(getDb(), sectionId));
}
