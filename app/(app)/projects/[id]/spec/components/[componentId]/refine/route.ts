import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardSpecWrite, buildAnthropic, anthropicErrorResponse } from '@/spec/handler-guard';
import { refineSection } from '@/spec/auto-draft';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

const bodySchema = z.object({
  userAnswer: z.string().trim().min(1, 'An answer is required.'),
  history: z.array(z.object({
    role: z.enum(['forge', 'user']),
    text: z.string(),
  })).default([]),
});

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

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
      componentId,
      userAnswer: parsed.data.userAnswer,
      history: parsed.data.history,
    });
    return NextResponse.json({ refinement: result });
  } catch (e) {
    return anthropicErrorResponse(e);
  }
}
