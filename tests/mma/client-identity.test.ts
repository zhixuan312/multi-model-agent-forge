// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MmaClient } from '@/mma/client';

/**
 * The engine allowlists `claude-code|cursor|codex-cli|gemini-cli` and answers
 * `400 client_required` on every tool route for anything else. A blank `MMA_CLIENT`
 * (set but empty) used to pass `??` untouched and send an empty header, which the engine
 * reads as unknown — taking down every dispatch for a variable someone merely left blank.
 */
describe('the X-MMA-Client header is always an allowlisted value', () => {
  const headerFrom = async (env: string | undefined, explicit?: string): Promise<string> => {
    const prev = process.env.MMA_CLIENT;
    if (env === undefined) delete process.env.MMA_CLIENT;
    else process.env.MMA_CLIENT = env;
    let sent = '';
    const client = new MmaClient(
      { baseUrl: 'http://127.0.0.1:7337', token: 't', mainModel: 'm' },
      {
        ...(explicit ? { client: explicit } : {}),
        fetchImpl: (async (_u: string, init: RequestInit) => {
          sent = (init.headers as Record<string, string>)['X-MMA-Client'];
          return new Response(JSON.stringify({ taskId: 'x' }), { status: 202 });
        }) as unknown as typeof fetch,
      },
    );
    await client.dispatch('orchestrate', { cwd: '/w', body: {} });
    if (prev === undefined) delete process.env.MMA_CLIENT;
    else process.env.MMA_CLIENT = prev;
    return sent;
  };

  it('falls back when MMA_CLIENT is unset', async () => {
    expect(await headerFrom(undefined)).toBe('claude-code');
  });

  it('falls back when MMA_CLIENT is set but blank', async () => {
    expect(await headerFrom('')).toBe('claude-code');
    expect(await headerFrom('   ')).toBe('claude-code');
  });

  it('honours an explicit value', async () => {
    expect(await headerFrom(undefined, 'cursor')).toBe('cursor');
    expect(await headerFrom('gemini-cli')).toBe('gemini-cli');
  });
});
