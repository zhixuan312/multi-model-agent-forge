import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { startLoopRun } from '@/loops/run-now';

/**
 * Admin "Run now" (spec §5/§6). Fires the loop's run engine in the background and
 * returns the `runId` immediately (202); the UI polls run history for outcomes.
 * Identical execution path to a scheduled fire — which is what makes manual
 * testing trustworthy.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const result = await startLoopRun(id, 'manual');
  if (result.kind === 'started') return NextResponse.json({ runId: result.runId }, { status: 202 });
  // Event-mode loops are fired only via the authenticated event endpoint, never "Run now".
  if (result.kind === 'wrong_mode') {
    return NextResponse.json({ error: 'event_loops_run_via_event_endpoint' }, { status: 409 });
  }
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}
