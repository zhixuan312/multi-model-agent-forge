import { NextResponse, type NextRequest } from 'next/server';
import { guardExploreWrite } from '@/exploration/guard';
import { proposeFanOut } from '@/exploration/fan-out';
import { AnthropicConfigError } from '@/anthropic/client';
import { USE_MOCK } from '@/mock/config';
import { proposeMockTasks } from '@/mock/domains/projects/explore-tasks';

/** `POST /api/projects/[id]/explore/propose` — the main-agent fan-out proposal.
 *  Zod-validated, deterministic per-failure drop/repair, atomic insert of the
 *  conformant set; a failed/unparseable response inserts zero rows. */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // Mock: seed a 5·5·5 fan-out so "Analyze sources" populates the proposal.
  if (USE_MOCK) {
    const tasks = proposeMockTasks(id);
    return NextResponse.json({ tasks, empty: tasks.length === 0 });
  }

  const guard = await guardExploreWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  try {
    const res = await proposeFanOut(id, { id: guard.memberId });
    if (res.failed) {
      return NextResponse.json(
        { error: 'Analysis failed — try again.', retryable: true, tasks: [] },
        { status: 502 },
      );
    }
    return NextResponse.json({ tasks: res.inserted, empty: res.inserted.length === 0 });
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return NextResponse.json({ error: err.message, retryable: false }, { status: 503 });
    }
    return NextResponse.json({ error: 'Analysis failed — try again.', retryable: true }, { status: 502 });
  }
}
