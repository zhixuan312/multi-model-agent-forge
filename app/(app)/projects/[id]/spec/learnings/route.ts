import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { guardSpecWrite, buildAnthropic, anthropicErrorResponse } from '@/spec/handler-guard';
import { proposeLearnings } from '@/spec/learnings';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/spec/learnings` — ensure the at-freeze `learning_candidate` set exists
 * (idempotent propose, mock-safe) and return it for the /freeze curation list.
 * Runs post-freeze (no `requireUnfrozen`). Any project member.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  try {
    const anthropic = await buildAnthropic();
    const candidates = await proposeLearnings({ db: getDb(), anthropic }, id);
    return NextResponse.json({ candidates });
  } catch (e) {
    return anthropicErrorResponse(e);
  }
}
