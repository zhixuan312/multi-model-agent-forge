import { NextResponse, type NextRequest } from 'next/server';
import { guardProjectRead } from '@/auth/guard-project-write';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { getDb } from '@/db/client';
import { performTransition, TransitionRejected } from '@/automation/perform-transition';
import { transitionSchema } from '@/automation/action-schema';
import { InvalidActionInput } from '@/automation/action-errors';
import '@/dispatch/handler-registry';

export const runtime = 'nodejs';

/**
 * The SINGLE lifecycle-mutation endpoint (spec §4.5). It validates {action, data} at
 * the boundary and hands off to `performTransition` — it does NOT pre-gate (never
 * calls `allowedActions` itself), so there is exactly one gate + resolver site.
 * `TransitionRejected` (gate refused: not-allowed / busy / mode) → 409;
 * `InvalidActionInput` (the kind is fine, its `data` is not) → 400.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const gate = await guardProjectRead(id);
  if (gate instanceof Response) return gate;

  const json = await req.json().catch(() => null);
  const parsed = transitionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid action', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await performTransition(
      getDb(),
      id,
      { kind: parsed.data.action, data: parsed.data.data, from: parsed.data.from },
      { mode: 'manual', actorId: gate.memberId },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TransitionRejected) {
      return NextResponse.json({ error: e.reason }, { status: 409 });
    }
    // A bad payload is the caller's error: answer 400 with what was wrong, rather than
    // letting it surface as a bare 500 the user can't act on.
    if (e instanceof InvalidActionInput) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
