import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { performTransition, TransitionRejected } from '@/automation/perform-transition';
import { transitionSchema } from '@/automation/action-schema';
import '@/dispatch/handler-registry';

export const runtime = 'nodejs';

/**
 * The SINGLE lifecycle-mutation endpoint (spec §4.5). It validates {action, data} at
 * the boundary and hands off to `performTransition` — it does NOT pre-gate (never
 * calls `allowedActions` itself), so there is exactly one gate + resolver site.
 * `TransitionRejected` (gate refused: not-allowed / busy / mode) → 409.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actor = projectActorFromMember(me);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = transitionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid action', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await performTransition(
      getDb(),
      id,
      { kind: parsed.data.action, data: parsed.data.data },
      { mode: 'manual', actorId: me.id },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TransitionRejected) {
      return NextResponse.json({ error: e.reason }, { status: 409 });
    }
    throw e;
  }
}
