// @vitest-environment node
import { vi } from 'vitest';
import { MmaClient, type MmaClientConfig } from '@/mma/client';

const baseCfg: MmaClientConfig = {
  baseUrl: 'http://127.0.0.1:7337',
  token: 'secret-bearer-xyz',
  mainModel: 'claude-opus-4-8',
};

/** A fetch stub that records calls and returns scripted Responses. */
function stubFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return responder(url, init);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function headerVal(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers as Record<string, string> | undefined;
  if (!h) return null;
  const found = Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return found ? found[1] : null;
}

describe('MmaClient.dispatch', () => {
  // Hermetic: the dev `.env` may set MMA_CLIENT (e.g. claude-code for the live
  // server's allowlist). Clear it so the `forge` default is tested deterministically.
  let savedClient: string | undefined;
  beforeEach(() => {
    savedClient = process.env.MMA_CLIENT;
    delete process.env.MMA_CLIENT;
  });
  afterEach(() => {
    if (savedClient === undefined) delete process.env.MMA_CLIENT;
    else process.env.MMA_CLIENT = savedClient;
  });

  it('POSTs /task?cwd=<path> with unified API { type, ... }, returns { batchId }, and sets the three headers', async () => {
    const { fn, calls } = stubFetch(() =>
      new Response(JSON.stringify({ taskId: 'b-1', statusUrl: '/task/b-1' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    const res = await client.dispatch('audit', { cwd: '/work/repo', body: { type: 'audit', document: 'hi' } });

    expect(res.batchId).toBe('b-1');
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork%2Frepo');
    expect(c.init?.method).toBe('POST');
    expect(headerVal(c.init, 'Authorization')).toBe('Bearer secret-bearer-xyz');
    expect(headerVal(c.init, 'X-MMA-Client')).toBe('claude-code');
    expect(headerVal(c.init, 'X-MMA-Main-Model')).toBe('claude-opus-4-8');
    expect(headerVal(c.init, 'content-type')).toMatch(/application\/json/);
    expect(c.init?.body).toBe(JSON.stringify({ type: 'audit', document: 'hi' }));
  });

  it('honors a client override (interop with the current allowlist-enforcing server)', async () => {
    const { fn, calls } = stubFetch(() =>
      new Response(JSON.stringify({ taskId: 'b' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn, client: 'claude-code' });
    await client.dispatch('audit', { cwd: '/w', body: { type: 'audit' } });
    expect(headerVal(calls[0]!.init, 'X-MMA-Client')).toBe('claude-code');
  });

  it('omits X-MMA-Main-Model when mainModel is null', async () => {
    const { fn, calls } = stubFetch(() =>
      new Response(JSON.stringify({ taskId: 'b-2' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MmaClient({ ...baseCfg, mainModel: null }, { fetchImpl: fn });
    await client.dispatch('investigate', { cwd: '/w', body: {} });
    expect(headerVal(calls[0]!.init, 'X-MMA-Main-Model')).toBeNull();
  });

  it('throws a dispatch error on a non-202 status without leaking the token', async () => {
    const { fn } = stubFetch(() =>
      new Response(JSON.stringify({ error: 'bad' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    const err = await client.dispatch('audit', { cwd: '/w', body: {} }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('secret-bearer-xyz');
    expect((err as Error).message).toMatch(/400/);
  });
});

describe('MmaClient.poll', () => {
  it('returns { state: "pending" } on a 202 JSON running status', async () => {
    const { fn } = stubFetch(() =>
      new Response(JSON.stringify({ taskId: 'b-1', status: 'running', phase: 'Auditing', elapsedMs: 1200 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    const r = await client.poll('b-1');
    expect(r.state).toBe('pending');
    if (r.state === 'pending') {
      expect(r.headline).toContain('Auditing');
      expect(r.phase).toBe('Auditing');
      expect(r.elapsedMs).toBe(1200);
    }
  });

  it('returns { state: "terminal", envelope } on a 200 application/json envelope', async () => {
    const envelope = {
      headline: 'audit: 1 task(s) complete',
      results: [{ taskId: 't0', findings: [] }],
      batchTimings: { wallClockMs: 100 },
      costSummary: { totalActualCostUSD: 0.01 },
      structuredReport: { summary: 'No findings' },
      error: { kind: 'not_applicable', reason: 'batch succeeded' },
    };
    const { fn } = stubFetch(() =>
      new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    const r = await client.poll('b-1');
    expect(r.state).toBe('terminal');
    if (r.state === 'terminal') {
      expect((r.envelope as { headline: string }).headline).toBe('audit: 1 task(s) complete');
    }
  });

  it('does NOT send Authorization on /health but DOES on /batch + /status', async () => {
    const { fn, calls } = stubFetch((url) => {
      if (url.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ version: '5', pid: 1, uptimeMs: 1, counters: { activeBatches: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.health();
    await client.status();
    const healthCall = calls.find((c) => c.url.includes('/health'))!;
    const statusCall = calls.find((c) => c.url.includes('/status'))!;
    expect(headerVal(healthCall.init, 'Authorization')).toBeNull();
    expect(headerVal(statusCall.init, 'Authorization')).toBe('Bearer secret-bearer-xyz');
  });
});

describe('MmaClient.health', () => {
  it('maps { status: "ok" } and { status: "drift" } through verbatim', async () => {
    const okFetch = stubFetch(() =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect((await new MmaClient(baseCfg, { fetchImpl: okFetch.fn }).health()).status).toBe('ok');

    const driftFetch = stubFetch(() =>
      new Response(JSON.stringify({ status: 'drift', drift: [{ skill: 'x' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const h = await new MmaClient(baseCfg, { fetchImpl: driftFetch.fn }).health();
    expect(h.status).toBe('drift');
  });

  it('maps a network error to an unreachable result (no throw, no token leak)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:7337');
    }) as unknown as typeof fetch;
    const h = await new MmaClient(baseCfg, { fetchImpl: fn }).health();
    expect(h.status).toBe('unreachable');
  });
});

describe('MmaClient.status', () => {
  it('surfaces a 401 as { reachable: true, authValid: false }', async () => {
    const { fn } = stubFetch(() =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const r = await new MmaClient(baseCfg, { fetchImpl: fn }).status();
    expect(r.reachable).toBe(true);
    expect(r.authValid).toBe(false);
  });

  it('returns the four consumed fields on a 200', async () => {
    const { fn } = stubFetch(() =>
      new Response(
        JSON.stringify({ version: '5.0.0', pid: 4242, uptimeMs: 9000, counters: { activeBatches: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const r = await new MmaClient(baseCfg, { fetchImpl: fn }).status();
    expect(r.reachable).toBe(true);
    expect(r.authValid).toBe(true);
    expect(r.version).toBe('5.0.0');
    expect(r.pid).toBe(4242);
    expect(r.uptimeMs).toBe(9000);
    expect(r.activeBatches).toBe(2);
  });
});

describe('MmaClient timeout', () => {
  it('aborts a hung fetch and surfaces unreachable on health()', async () => {
    const fn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    const client = new MmaClient(baseCfg, { fetchImpl: fn, timeoutMs: 10 });
    const h = await client.health();
    expect(h.status).toBe('unreachable');
  });

  it('aborts a hung dispatch and throws a redacted error', async () => {
    const fn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    const client = new MmaClient(baseCfg, { fetchImpl: fn, timeoutMs: 10 });
    const err = await client.dispatch('audit', { cwd: '/w', body: {} }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('secret-bearer-xyz');
  });
});

describe('MmaClient.dispatchAndWait', () => {
  it('dispatches then polls until terminal', async () => {
    let polls = 0;
    const { fn } = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ taskId: 'bw' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      // GET /task/bw
      polls += 1;
      if (polls < 2) {
        return new Response(JSON.stringify({ taskId: 'bw', status: 'running', phase: 'queued' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ headline: 'done', results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new MmaClient(baseCfg, { fetchImpl: fn, pollIntervalMs: 1 });
    const env = await client.dispatchAndWait('audit', { cwd: '/w', body: { document: 'x' } });
    expect((env as { headline: string }).headline).toBe('done');
    expect(polls).toBeGreaterThanOrEqual(2);
  });
});

describe('MmaClient.configureProvider', () => {
  it('POSTs /configure-provider with the body + bearer and returns the parsed result', async () => {
    const { fn, calls } = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            verified: true,
            reason: 'ok',
            applied: false,
            tier: 'standard',
            provider: 'claude',
            model: { id: 'claude-opus-4-8', family: 'claude', tier: 'reasoning', recognized: true },
            probe: { reachable: true, modelListed: true, detail: 'listed' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    const res = await client.configureProvider({
      tier: 'standard',
      provider: 'claude',
      model: 'claude-opus-4-8',
      auth: { mode: 'oauth' },
      dryRun: true,
    });

    expect(calls[0]!.url).toBe('http://127.0.0.1:7337/configure-provider');
    expect((calls[0]!.init as RequestInit).method).toBe('POST');
    expect(headerVal(calls[0]!.init, 'authorization')).toBe('Bearer secret-bearer-xyz');
    const body = JSON.parse((calls[0]!.init as RequestInit).body as string);
    expect(body).toMatchObject({ tier: 'standard', provider: 'claude', dryRun: true });
    expect(res.verified).toBe(true);
    expect(res.model.recognized).toBe(true);
  });

  it('throws on a non-200 response', async () => {
    const { fn } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'invalid_request' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await expect(
      client.configureProvider({ tier: 'standard', provider: 'claude', model: 'x', auth: { mode: 'oauth' } }),
    ).rejects.toThrow(/configure-provider/i);
  });
});
