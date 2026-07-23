import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { projectEventBus, type ProjectEvent } from '@/sse/event-bus';

/**
 * Per-project SSE stream (Spec 5 §SSE). The server owns the MMA poll loop and
 * fans events here; the browser NEVER polls MMA. `force-dynamic` disables static
 * optimization/caching; the Node runtime is required (EventEmitter + MmaClient).
 *
 * Auth (session) + private-project visibility are checked ONCE at stream open
 * (open-once for v1; revocation takes effect on the next reconnect). A 15s
 * heartbeat keeps the connection past idle proxies and lets the client detect a
 * dead stream. nginx must run `proxy_buffering off` on this location;
 * `X-Accel-Buffering: no` is the in-app reinforcement.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 15_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // Auth (session) + private-project visibility are checked ONCE at stream open.
  const me = await currentMember();
  if (!me) return new Response('Unauthorized', { status: 401 });
  const actor = projectActorFromMember(me);
  if (!actor) return new Response('Unauthorized', { status: 401 });
  try {
    await assertProjectReadable(id, actor);
  } catch (e) {
    if (e instanceof ProjectAccessError) return new Response('Not found', { status: 404 });
    throw e;
  }

  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: ProjectEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };
      unsub = projectEventBus.subscribe(id, send);
      hb = setInterval(() => send({ type: 'heartbeat', t: Date.now() }), HEARTBEAT_MS);
      if (typeof hb.unref === 'function') hb.unref();

      const onAbort = () => {
        if (hb) clearInterval(hb);
        if (unsub) unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', onAbort);
      // The auth checks above are awaited BEFORE the stream is built, so the client can disconnect
      // during that window — leaving req.signal ALREADY aborted here. addEventListener never fires
      // for an already-aborted signal (and cancel() won't run for a stream nothing consumes), so the
      // heartbeat interval + bus subscription would leak. Fire onAbort immediately in that case
      // (unsub is guarded against double-unsub, so this is idempotent with a later abort/cancel).
      if (req.signal.aborted) onAbort();
    },
    cancel() {
      if (hb) clearInterval(hb);
      if (unsub) unsub();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
