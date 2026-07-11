// @vitest-environment node
import { vi } from 'vitest';
import { buildMmaClient } from '@/mma/server-client';
import { DEFAULT_MAIN_MODEL } from '@/anthropic/client';

/**
 * Regression: MMA rejects every tool route with 400 `main_model_required` when
 * `X-MMA-Main-Model` is absent. The configured `main` model is null pre-config, so
 * `buildMmaClient` MUST default the header — otherwise the whole Exploration /
 * audit / build-pipeline dispatch surface 400s.
 */

// db with NO team_connection row; the main model comes from config.json,
// injected as an unconfigured tier set (`noTiers`) below.
 
function dbNoSettings(): any {
  return { select: () => ({ from: () => ({ limit: async () => [] }) }) };
}
const noTiers = () => ({ main: null, complex: null, standard: null });

function headerVal(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers as Record<string, string> | undefined;
  if (!h) return null;
  const hit = Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit ? hit[1] : null;
}

describe('buildMmaClient', () => {
  it('defaults X-MMA-Main-Model when the roster main model is unset (no 400)', async () => {
    const prev = process.env.MMA_AUTH_TOKEN;
    process.env.MMA_AUTH_TOKEN = 'test-bearer'; // dev token fallback
    const calls: { url: string; init?: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ taskId: 'b-1' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const client = await buildMmaClient({ db: dbNoSettings(), tiers: noTiers });
      const res = await client.investigate('/tmp/repo', { prompt: 'hi there' });
      expect(res.batchId).toBe('b-1');
      expect(headerVal(calls[0]!.init, 'X-MMA-Main-Model')).toBe(DEFAULT_MAIN_MODEL);
    } finally {
      globalThis.fetch = realFetch;
      if (prev === undefined) delete process.env.MMA_AUTH_TOKEN;
      else process.env.MMA_AUTH_TOKEN = prev;
    }
  });
});
