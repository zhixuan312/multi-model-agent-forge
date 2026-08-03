import { getDb, type Db } from '@/db/client';
import { connectionSettings } from '@/db/schema/identity';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import { logEvent } from '@/observability/log-event';
import { errName } from '@/lib/err';

/**
 * Server-side voice transcription via OpenAI `gpt-4o-transcribe` (Spec 5 §Voice).
 * The OpenAI key is resolved from `settings_connection.openai_transcription_key_ref`
 * and NEVER reaches the browser; the audio bytes + key are never logged.
 *
 * This used to claim it was "the ONLY non-Anthropic, non-MMA external call in the
 * product". It is not: `config/connections-probe.ts` calls `api.github.com/user` and the
 * provider's `/models`, and `build/pr.ts` calls the GitHub API. It IS the only outbound
 * call that ships user CONTENT, which is the property worth stating.
 */

export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
export const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** Hard request timeout on the upstream OpenAI call (a hung upstream → 5xx). */
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** Max clip byte size (OpenAI's own per-file ceiling). */
export const MAX_CLIP_BYTES = 25 * 1024 * 1024;
/**
 * Max clip duration (a Forge cost/upload ceiling, not OpenAI's).
 *
 * The duration is reported by the CLIENT — nothing here decodes the audio — so this is a
 * cost hint, not an enforced bound. `MAX_CLIP_BYTES` is the guard that actually holds,
 * because the byte size is measured server-side off the Blob.
 */
export const MAX_DURATION_MS = 600_000;
/**
 * Accepted clip MIME → the filename EXTENSION OpenAI reads the format from.
 *
 * One map rather than an allow-list plus a lookup table, so the set we accept and the set we
 * can name upstream cannot drift apart. Every extension here is on OpenAI's supported list.
 *
 * The extension is not cosmetic: `/v1/audio/transcriptions` takes the format from the
 * multipart filename, and this code uploaded every clip as a file called `audio` — no
 * extension at all — after gating on a MIME it then discarded. The recorder produces
 * `audio/webm;codecs=opus` on Chrome/Firefox and `audio/mp4` on Safari, so the one fact
 * OpenAI needs was known, validated, and dropped on the floor.
 */
export const ACCEPTED_AUDIO_MIME = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/m4a': 'm4a',
} as const;
export type AcceptedAudioMime = keyof typeof ACCEPTED_AUDIO_MIME;
export type AudioExtension = (typeof ACCEPTED_AUDIO_MIME)[AcceptedAudioMime];

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

/**
 * Thrown when the upstream OpenAI call errors (network / non-2xx). Carries the status the
 * ROUTE should return, which is not always 502: a rejected key is our configuration being
 * wrong, not the service being down, and telling an operator "the transcription service is
 * unavailable" when their key is bad sends them to look at the wrong thing entirely.
 */
export class TranscriptionUpstreamError extends Error {
  readonly status: number;
  constructor(message = 'The transcription service is unavailable.', status = 502) {
    super(message);
    this.name = 'TranscriptionUpstreamError';
    this.status = status;
  }
}

/**
 * What a non-2xx from OpenAI means for US. Pure so the mapping is testable without a network.
 *
 * The upstream `error.message` is deliberately NOT an input: it is logged, never returned,
 * because a 401 body echoes a partially-masked key and that is not something to hand back to
 * a browser. What the caller sees is chosen here, from the status alone.
 */
export function classifyUpstream(status: number): { status: number; message: string } {
  if (status === 401 || status === 403) {
    return { status: 400, message: 'The configured OpenAI key was rejected — check it in Connections.' };
  }
  if (status === 429) {
    return { status: 429, message: 'OpenAI is rate-limiting transcription — try again shortly.' };
  }
  if (status >= 400 && status < 500) {
    return { status: 502, message: 'OpenAI rejected the audio clip.' };
  }
  return { status: 502, message: 'The transcription service is unavailable.' };
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
 *
 * RETURNS the extension the accepted MIME maps to. The gate is the only place that decides
 * a MIME is acceptable, so it is also the only place that can name the format — handing it
 * back means the upload needs no second lookup and no cast.
 */
export function gateClip(args: { byteSize: number; mime: string; durationMs: number }): AudioExtension {
  const base = baseMime(args.mime);
  if (!(base in ACCEPTED_AUDIO_MIME)) {
    throw new TranscriptionRejectError(415, 'Unsupported audio type.');
  }
  if (args.byteSize > MAX_CLIP_BYTES) {
    throw new TranscriptionRejectError(413, 'Audio clip exceeds the 25 MB limit.');
  }
  if (args.durationMs > MAX_DURATION_MS) {
    throw new TranscriptionRejectError(413, 'Audio clip exceeds the 10 minute limit.');
  }
  return ACCEPTED_AUDIO_MIME[base as AcceptedAudioMime];
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
  const ext = gateClip({ byteSize: args.clip.size, mime: args.mime, durationMs: args.durationMs });

  const key = await resolveTranscriptionKey(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;

  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('file', args.clip, `audio.${ext}`);

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
    logEvent({ level: 'error', event: 'openai.call_error', detail: errName(err) });
    throw new TranscriptionUpstreamError();
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The upstream MESSAGE is the whole diagnosis — "Invalid file format", "Incorrect API
    // key" — and only the status code was being kept. Logged server-side, truncated, and
    // never returned: OpenAI's 401 body echoes a partially-masked key.
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const detail = body?.error?.message;
    const mapped = classifyUpstream(res.status);
    logEvent({
      level: 'error',
      event: 'openai.call_error',
      detail: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    });
    throw new TranscriptionUpstreamError(mapped.message, mapped.status);
  }
  const json = (await res.json().catch(() => null)) as { text?: string } | null;
  return { text: typeof json?.text === 'string' ? json.text : '' };
}

