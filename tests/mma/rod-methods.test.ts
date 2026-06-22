// @vitest-environment node
import { vi } from 'vitest';
import { MmaClient, type MmaClientConfig } from '@/mma/client';

const baseCfg: MmaClientConfig = {
  baseUrl: 'http://127.0.0.1:7337',
  token: 'secret-bearer-xyz',
  mainModel: 'claude-opus-4-8',
};

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(JSON.stringify({ taskId: 'b-1', statusUrl: '/task/b-1' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(init?.body as string);
}

function header(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers as Record<string, string> | undefined;
  if (!h) return null;
  const found = Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return found ? found[1] : null;
}

describe('MmaClient rod methods', () => {
  it('investigate POSTs /task?cwd=<repo> with unified API { type, prompt, target } + three headers', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn, client: 'claude-code' });
    const res = await client.investigate('/work/api', { prompt: 'how does auth work?' });

    expect(res.batchId).toBe('b-1');
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork%2Fapi');
    expect(c.init?.method).toBe('POST');
    expect(header(c.init, 'Authorization')).toBe('Bearer secret-bearer-xyz');
    expect(header(c.init, 'X-MMA-Client')).toBe('claude-code');
    expect(header(c.init, 'X-MMA-Main-Model')).toBe('claude-opus-4-8');
    expect(bodyOf(c.init)).toEqual({
      type: 'investigate',
      prompt: 'how does auth work?',
      target: { paths: [] },
    });
  });

  it('investigate forwards optional paths + contextBlockIds when present', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.investigate('/w', {
      prompt: 'x',
      paths: ['src/auth.ts'],
      contextBlockIds: ['cb-1'],
    });
    expect(bodyOf(calls[0]!.init)).toEqual({
      type: 'investigate',
      prompt: 'x',
      target: { paths: ['src/auth.ts'] },
      contextBlockIds: ['cb-1'],
    });
  });

  it('research POSTs /task?cwd=<repo> with unified API including type', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.research('/work', {
      prompt: 'what approaches exist for X today? we need prior art here.',
    });
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork');
    const body = bodyOf(c.init);
    expect(Object.keys(body).sort()).toEqual(['prompt', 'type']);
    expect(body.type).toBe('research');
    expect(body).not.toHaveProperty('agentType');
    expect(body).not.toHaveProperty('tools');
  });

  it('research rejects a sub-20-char prompt BEFORE dispatch (never reaches MMA)', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await expect(client.research('/work', { prompt: 'too short' })).rejects.toThrow(/at least 20/);
    expect(calls).toHaveLength(0);
  });

  it('journalRecall POSTs /task?cwd=<workspace root> with unified API { type, prompt }', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.journalRecall('/work', { prompt: 'what did we learn about caching?' });
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork');
    expect(bodyOf(c.init)).toEqual({ type: 'journal_recall', prompt: 'what did we learn about caching?' });
  });

  it('journalRecall rejects a sub-10-char prompt before dispatch', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await expect(client.journalRecall('/work', { prompt: 'short' })).rejects.toThrow(/at least 10/);
    expect(calls).toHaveLength(0);
  });
});
