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
  classifyUpstream,
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

  /**
   * `/v1/audio/transcriptions` reads the format from the multipart FILENAME. Every clip went
   * up as a file called `audio` — no extension — after being gated on a MIME that was then
   * discarded, so the one fact OpenAI needs was known, validated, and dropped. The old test
   * asserted only `toBeInstanceOf(Blob)`, which the broken version satisfied.
   */
  it('names the upload with the extension for the clip’s MIME', async () => {
    const names: string[] = [];
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const file = ((init as { body?: FormData }).body as FormData).get('file');
      names.push((file as File).name);
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;

    for (const mime of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/mpeg']) {
      await transcribe(
        { clip: clip(100, mime), mime, durationMs: 5000 },
        { db: dbWithKey('ref'), secrets: keyStore, fetchImpl },
      );
    }
    // webm from Chrome/Firefox, mp4 from Safari — the two the recorder actually produces.
    expect(names).toEqual(['audio.webm', 'audio.mp4', 'audio.mp3']);
  });

  it('gateClip hands back the extension rather than making the caller look it up', () => {
    expect(gateClip({ byteSize: 10, mime: 'audio/webm;codecs=opus', durationMs: 1 })).toBe('webm');
    expect(gateClip({ byteSize: 10, mime: 'audio/m4a', durationMs: 1 })).toBe('m4a');
  });

  /**
   * Every non-2xx became "The transcription service is unavailable." at 502. A 401 means the
   * KEY is wrong — the service is fine — and that sentence sends an operator to look at
   * OpenAI's status page instead of their own Connections settings.
   */
  describe('what a non-2xx from OpenAI actually means', () => {
    it('a rejected key is our configuration, not an outage', () => {
      expect(classifyUpstream(401)).toEqual({
        status: 400,
        message: 'The configured OpenAI key was rejected — check it in Connections.',
      });
      expect(classifyUpstream(403).status).toBe(400);
    });

    it('a rate limit says so, and keeps the status', () => {
      expect(classifyUpstream(429).status).toBe(429);
      expect(classifyUpstream(429).message).toMatch(/rate-limit/);
    });

    it('a rejected clip is distinguished from an unavailable service', () => {
      expect(classifyUpstream(400).message).toBe('OpenAI rejected the audio clip.');
      expect(classifyUpstream(500).message).toBe('The transcription service is unavailable.');
      expect(classifyUpstream(503).status).toBe(502);
    });

    it('carries the mapped status onto the thrown error', async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-***ABCD' } }), { status: 401 }),
      ) as unknown as typeof fetch;
      await expect(
        transcribe(
          { clip: clip(100, 'audio/webm'), mime: 'audio/webm', durationMs: 5000 },
          { db: dbWithKey('ref'), secrets: keyStore, fetchImpl },
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('never returns the upstream body — a 401 echoes a masked key', async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-ABCD' } }), { status: 401 }),
      ) as unknown as typeof fetch;
      const err: unknown = await transcribe(
        { clip: clip(100, 'audio/webm'), mime: 'audio/webm', durationMs: 5000 },
        { db: dbWithKey('ref'), secrets: keyStore, fetchImpl },
      ).catch((e: unknown) => e);
      expect((err as Error).message).not.toContain('sk-proj');
    });
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
