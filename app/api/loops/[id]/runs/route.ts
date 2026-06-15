import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { listLoopRuns } from '@/loops/run-now';

/** Admin run-history for a loop (spec §6). Newest first; group by `run_id` in the UI. */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  return NextResponse.json({ runs: await listLoopRuns(id) });
}
