import { NextResponse, type NextRequest } from 'next/server';
import { guardBuildWrite } from '@/build/guard';
import { AnthropicClient } from '@/anthropic/client';
import { authorPlan } from '@/build/plan-author';

/**
 * `POST /api/.../build/author-plan` — author the build plan from the frozen spec
 * (Spec 7 §Plan authoring). Decomposes per repo, writes per-repo plan files, and
 * persists plan_task rows + the plan artifact. Read-only against repos here (no
 * execute-plan dispatch).
 */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const anthropic = await AnthropicClient.fromMainTier();
  const result = await authorPlan({ anthropic }, { projectId: id, actorId: guard.memberId });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }
  return NextResponse.json(result);
}
