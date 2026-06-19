import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardSpecWrite, buildAnthropic, anthropicErrorResponse } from '@/spec/handler-guard';
import { refineSection } from '@/spec/auto-draft';
import { buildSectionRepaint } from '@/spec/spec-core';
import { getDb } from '@/db/client';

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

const bodySchema = z.object({
  userAnswer: z.string().trim().min(1, 'An answer is required.'),
  history: z.array(z.object({
    role: z.enum(['forge', 'user']),
    text: z.string(),
  })).default([]),
});

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
    const result = await refineSection({
      anthropic,
      sectionId,
      userAnswer: parsed.data.userAnswer,
      history: parsed.data.history,
    });
    const repaint = await buildSectionRepaint(getDb(), sectionId);
    return NextResponse.json({ ...repaint, refinement: result });
  } catch (e) {
    return anthropicErrorResponse(e);
  }
}
