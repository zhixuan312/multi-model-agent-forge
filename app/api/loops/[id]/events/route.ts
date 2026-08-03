import { NextResponse, type NextRequest } from 'next/server';
import { acceptLoopEvent } from '@/loops/event-trigger';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const result = await acceptLoopEvent({
    loopId: id,
    authorization: req.headers.get('authorization'),
    idempotencyKey: req.headers.get('idempotency-key'),
    body: json,
  });

  switch (result.kind) {
    case 'accepted':
      return NextResponse.json({ runId: result.runId }, { status: 202 });
    case 'invalid_request':
      return NextResponse.json({ error: 'invalid_request', message: 'The request was malformed.' }, { status: 400 });
    case 'unauthorized':
      return NextResponse.json({ error: 'unauthorized', message: 'You are not allowed to do that.' }, { status: 401 });
    case 'wrong_mode':
      return NextResponse.json({ error: 'wrong_mode', message: 'This loop is not in event mode.' }, { status: 403 });
    case 'disabled':
      return NextResponse.json({ error: 'disabled', message: 'This loop is paused.' }, { status: 403 });
    case 'not_found':
      return NextResponse.json({ error: 'not_found', message: 'That loop no longer exists.' }, { status: 404 });
    case 'internal_error':
      return NextResponse.json({ error: 'internal_error', message: 'The event could not be processed.' }, { status: 500 });
  }
}
