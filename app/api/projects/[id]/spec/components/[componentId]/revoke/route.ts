import { NextResponse, type NextRequest } from 'next/server';
import { guardProjectWrite } from '@/auth/guard-project-write';
import { getDb } from '@/db/client';
import { updateDetails } from '@/details/write';
import { projectEventBus } from '@/sse/event-bus';

type Ctx = { params: Promise<{ id: string; componentId: string }> };

/** Thrown from inside the details mutator when the component id names nothing. */
class ComponentNotFound extends Error {}

/**
 * `POST …/components/[componentId]/revoke` — withdraw the caller's approval of one spec
 * component.
 *
 * The caller comes from the GUARD. This used to call `currentMember()` a second time
 * after `guardProjectWrite` had already resolved the same member — a second DB round-trip
 * and a second source of truth for "who is acting", whose `if (!me) return unauthorized()`
 * could never run because the guard had already answered 401.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, componentId } = await ctx.params;

  const guard = await guardProjectWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;
  const me = guard.member;
  const db = getDb();

  try {
    await updateDetails(db, id, (d) => {
      const comp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
      // An unknown component used to fall through to `{ ok: true }` — the caller was told
      // their approval had been withdrawn when nothing had been touched.
      if (!comp) throw new ComponentNotFound();
      comp.approvals = comp.approvals.filter((a) => a !== me.id);
      return d;
    });
  } catch (e) {
    if (e instanceof ComponentNotFound) {
      return NextResponse.json({ error: 'That component is not part of this spec.' }, { status: 404 });
    }
    throw e;
  }

  projectEventBus.publish(id, { type: 'spec.updated' });
  return NextResponse.json({ ok: true });
}
