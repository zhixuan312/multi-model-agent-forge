import { NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import {
  transcribe,
  TranscriptionNotConfiguredError,
  TranscriptionRejectError,
  TranscriptionUpstreamError,
} from '@/transcribe/openai';

/**
 * `POST /api/transcribe` (Spec 5 §Voice) — server-side voice→text via OpenAI
 * `gpt-4o-transcribe`. Session-authenticated. `multipart/form-data` with the
 * audio `file` Blob + a `durationMs` field (the composer's MediaRecorder
 * start→stop wall-clock; the route does NOT decode the container). The OpenAI
 * key is resolved server-side and never reaches the browser.
 */
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing audio file.' }, { status: 400 });
  }
  const durationRaw = form.get('durationMs');
  const durationMs = Number(typeof durationRaw === 'string' ? durationRaw : 0);

  try {
    const { text } = await transcribe({
      clip: file,
      mime: file.type,
      durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    });
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof TranscriptionRejectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof TranscriptionNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof TranscriptionUpstreamError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 500 });
  }
}
