import { getDb, type Db } from '@/db/client';
import { connectionSettings } from '@/db/schema/identity';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import { logPoll } from '@/observability/poll-log';

/**
 * Server-side voice transcription via OpenAI `gpt-4o-transcribe` (Spec 5 §Voice).
 * The OpenAI key is resolved from `settings_connection.openai_transcription_key_ref`
 * and NEVER reaches the browser; the audio bytes + key are never logged. This is
 * the ONLY non-Anthropic, non-MMA external call in the product.
 */

export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
export const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** Hard request timeout on the upstream OpenAI call (a hung upstream → 5xx). */
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** Max clip byte size (OpenAI's own per-file ceiling). */
export const MAX_CLIP_BYTES = 25 * 1024 * 1024;
/** Max clip duration (a Forge cost/upload ceiling, not OpenAI's). */
export const MAX_DURATION_MS = 600_000;
/** Accepted clip MIME allow-list (rejected before the OpenAI call). */
export const ACCEPTED_AUDIO_MIME = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/m4a',
] as const;

/** Thrown when voice is not configured (no key ref). Maps to a typed 4xx/feature-off. */
export class TranscriptionNotConfiguredError extends Error {
  constructor(message = 'Voice transcription is not configured. Add an OpenAI key in Connections.') {
    super(message);
    this.name = 'TranscriptionNotConfiguredError';
  }
}

/** Thrown for a pre-call validation reject (size/duration/mime). Carries an HTTP status. */
export class TranscriptionRejectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TranscriptionRejectError';
    this.status = status;
  }
}

/** Thrown when the upstream OpenAI call errors (network / non-2xx). Maps to 5xx. */
export class TranscriptionUpstreamError extends Error {
  constructor(message = 'The transcription service is unavailable.') {
    super(message);
    this.name = 'TranscriptionUpstreamError';
  }
}

export interface TranscribeDeps {
  db?: Db;
  secrets?: SecretStore;
  /** Injectable for tests so no real OpenAI call is made. */
  fetchImpl?: typeof fetch;
}

/** Normalize a content-type string to its base MIME (drops `;codecs=…`). */
export function baseMime(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Pre-call gate (testable in isolation): reject oversized / over-duration /
 * disallowed-MIME clips BEFORE any OpenAI call. Throws `TranscriptionRejectError`
 * with the exact status (413 oversized · 415 unsupported type · 413 too long).
 */
export function gateClip(args: { byteSize: number; mime: string; durationMs: number }): void {
  if (!ACCEPTED_AUDIO_MIME.includes(baseMime(args.mime) as (typeof ACCEPTED_AUDIO_MIME)[number])) {
    throw new TranscriptionRejectError(415, 'Unsupported audio type.');
  }
  if (args.byteSize > MAX_CLIP_BYTES) {
    throw new TranscriptionRejectError(413, 'Audio clip exceeds the 25 MB limit.');
  }
  if (args.durationMs > MAX_DURATION_MS) {
    throw new TranscriptionRejectError(413, 'Audio clip exceeds the 10 minute limit.');
  }
}

/** Resolve the configured OpenAI key, or throw `TranscriptionNotConfiguredError`. */
export async function resolveTranscriptionKey(deps: TranscribeDeps = {}): Promise<string> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select({ ref: connectionSettings.openaiTranscriptionKeyRef })
    .from(connectionSettings)
    .limit(1);
  if (!row?.ref) throw new TranscriptionNotConfiguredError();
  const secrets = deps.secrets ?? (await PostgresSecretStore.create({ db }));
  const key = await secrets.get(row.ref);
  if (!key) throw new TranscriptionNotConfiguredError();
  return key;
}

/**
 * Transcribe a clip. Gates the clip, resolves the key, and POSTs to OpenAI with
 * `model=gpt-4o-transcribe`. Returns `{ text }`. The key/audio are never logged.
 */
export async function transcribe(
  args: { clip: Blob; mime: string; durationMs: number },
  deps: TranscribeDeps = {},
): Promise<{ text: string }> {
  gateClip({ byteSize: args.clip.size, mime: args.mime, durationMs: args.durationMs });

  const key = await resolveTranscriptionKey(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;

  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('file', args.clip, 'audio');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    logPoll({ level: 'error', event: 'openai.call_error', detail: errName(err) });
    throw new TranscriptionUpstreamError();
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    logPoll({ level: 'error', event: 'openai.call_error', detail: `HTTP ${res.status}` });
    throw new TranscriptionUpstreamError();
  }
  const json = (await res.json().catch(() => null)) as { text?: string } | null;
  return { text: typeof json?.text === 'string' ? json.text : '' };
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
