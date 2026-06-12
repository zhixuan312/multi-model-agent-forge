import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardExploreWrite } from '@/exploration/guard';
import { dispatchTasks } from '@/exploration/dispatch';
import { getSynthesisScheduler } from '@/exploration/synthesis-scheduler';
import { USE_MOCK } from '@/mock/config';
import { runMockTasks } from '@/mock/domains/projects/explore-tasks';

/** `POST /api/projects/[id]/explore/run` — dispatch every `draft` task (or a
 *  given subset) in parallel on the standard tier. */
export const runtime = 'nodejs';

const bodySchema = z.object({ taskIds: z.array(z.string().uuid()).optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // Mock: "dispatch" the drafts so the agent rail shows running/recorded work.
  if (USE_MOCK) return NextResponse.json({ outcomes: runMockTasks(id) });

  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json ?? {});
  const taskIds = parsed.success ? parsed.data.taskIds : undefined;

  // Subscribe the synthesis scheduler to this project's bus so it
  // debounce-synthesizes once the poll loop records the terminal tasks —
  // otherwise the Exploration summary never auto-populates.
  getSynthesisScheduler().watch(id);

  const outcomes = await dispatchTasks(id, { id: guard.memberId }, {}, taskIds);
  return NextResponse.json({ outcomes });
}
