// @vitest-environment node
import { vi } from 'vitest';
import {
  transcribe,
  gateClip,
  baseMime,
  resolveTranscriptionKey,
  TranscriptionNotConfiguredError,
  TranscriptionRejectError,
  TranscriptionUpstreamError,
  MAX_CLIP_BYTES,
  TRANSCRIBE_MODEL,
} from '@/transcribe/openai';
import type { SecretStore } from '@/secrets/secret-store';

/** A stub SecretStore that resolves a fixed key. */
const keyStore: SecretStore = {
  put: async () => 'ref',
  get: async () => 'sk-test-key',
  delete: async () => {},
};

/** A db stub returning a team_settings row with a configured key ref. */
function dbWithKey(ref: string | null) {
  return {
    select: () => ({
      from: () => ({
        limit: async () => (ref === undefined ? [] : [{ ref }]),
      }),
    }),
  } as never;
}

function clip(bytes: number, mime: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

describe('transcribe gateClip (F2 — thresholds before any OpenAI call)', () => {
  it('rejects a MIME outside the allow-list with 415', () => {
    expect(() => gateClip({ byteSize: 10, mime: 'audio/ogg', durationMs: 1000 })).toThrow(
      TranscriptionRejectError,
    );
    try {
      gateClip({ byteSize: 10, mime: 'audio/ogg', durationMs: 1000 });
    } catch (e) {
      expect((e as TranscriptionRejectError).status).toBe(415);
    }
  });

  it('rejects a clip >25 MB with 413', () => {
    try {
      gateClip({ byteSize: MAX_CLIP_BYTES + 1, mime: 'audio/webm', durationMs: 1000 });
    } catch (e) {
      expect((e as TranscriptionRejectError).status).toBe(413);
    }
  });

  it('rejects durationMs > 600000 with 413', () => {
    try {
      gateClip({ byteSize: 10, mime: 'audio/webm', durationMs: 600_001 });
    } catch (e) {
      expect((e as TranscriptionRejectError).status).toBe(413);
    }
  });

  it('accepts webm/opus (codec suffix stripped) within limits', () => {
    expect(() => gateClip({ byteSize: 10, mime: 'audio/webm;codecs=opus', durationMs: 1000 })).not.toThrow();
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
  });
});

describe('transcribe key resolution + OpenAI call', () => {
  it('throws TranscriptionNotConfiguredError when no key ref is set', async () => {
    await expect(resolveTranscriptionKey({ db: dbWithKey(null), secrets: keyStore })).rejects.toThrow(
      TranscriptionNotConfiguredError,
    );
  });

  it('calls OpenAI with model=gpt-4o-transcribe and returns {text}; key never in the response', async () => {
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const form = (init as { body?: FormData }).body as FormData;
      expect(form.get('model')).toBe(TRANSCRIBE_MODEL);
      expect(form.get('file')).toBeInstanceOf(Blob);
      // The key rides the Authorization header, not the response.
      const h = init?.headers as Record<string, string>;
      expect(h.Authorization).toBe('Bearer sk-test-key');
      return new Response(JSON.stringify({ text: 'hello world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const out = await transcribe(
      { clip: clip(100, 'audio/webm'), mime: 'audio/webm', durationMs: 5000 },
      { db: dbWithKey('ref'), secrets: keyStore, fetchImpl },
    );
    expect(out).toEqual({ text: 'hello world' });
    expect(JSON.stringify(out)).not.toContain('sk-test-key');
  });

  it('maps an upstream OpenAI error to TranscriptionUpstreamError', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      transcribe(
        { clip: clip(100, 'audio/webm'), mime: 'audio/webm', durationMs: 5000 },
        { db: dbWithKey('ref'), secrets: keyStore, fetchImpl },
      ),
    ).rejects.toThrow(TranscriptionUpstreamError);
  });

  it('does not call OpenAI when the gate rejects', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      transcribe(
        { clip: clip(100, 'audio/ogg'), mime: 'audio/ogg', durationMs: 5000 },
        { db: dbWithKey('ref'), secrets: keyStore, fetchImpl },
      ),
    ).rejects.toThrow(TranscriptionRejectError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
