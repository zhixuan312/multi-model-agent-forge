import { type NextRequest, type NextResponse } from 'next/server';
import { postQaMessage } from '@/collab/post-qa-message';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

/** Thin adapter — the whole chain lives in `postQaMessage`, shared with the Spec route. */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;
  return postQaMessage(req, {
    projectId: id,
    targetId: taskId,
    targetKind: 'plan_task',
    where: 'Plan · Refine',
  });
}
