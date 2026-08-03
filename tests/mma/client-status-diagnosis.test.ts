// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MmaClient } from '@/mma/client';

/**
 * `status()` collapsed EVERY non-OK response into `authValid: false`, and the Connections
 * check renders that as "mma rejected the bearer token." So a 500 from a broken engine
 * sent the user off to regenerate a token that was never the problem.
 *
 * `authValid` now means what it says: the bearer was REJECTED. Any other failure is
 * reported through `error`, so the caller can tell "your token is wrong" from "the engine
 * is unwell".
 */
const clientReturning = (status: number, body: unknown = {}) =>
  new MmaClient(
    { baseUrl: 'http://127.0.0.1:7337', token: 't', mainModel: 'm' },
    { fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch },
  );

describe('status() distinguishes a rejected token from an unwell engine', () => {
  it('reports a rejected bearer on 401/403', async () => {
    for (const code of [401, 403]) {
      const r = await clientReturning(code).status();
      expect(r, `HTTP ${code}`).toMatchObject({ reachable: true, authValid: false });
    }
  });

  it('does NOT blame the token for a server error', async () => {
    const r = await clientReturning(500).status();
    expect(r.reachable).toBe(true);
    expect(r.authValid, 'a 500 says nothing about the bearer').toBe(true);
    expect(r.error).toMatch(/500/);
  });

  it('reports a healthy status with no error', async () => {
    const r = await clientReturning(200, { version: '5.16.0', pid: 42, counters: { activeTasks: 1 } }).status();
    expect(r).toMatchObject({ reachable: true, authValid: true, version: '5.16.0', activeTasks: 1 });
    expect(r.error).toBeUndefined();
  });
});
