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
    return new Response(JSON.stringify({ batchId: 'b-1', statusUrl: '/batch/b-1' }), {
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
  it('investigate POSTs /task?cwd=<repo> with unified API { type, ...body } + three headers', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn, client: 'claude-code' });
    const res = await client.investigate('/work/api', { question: 'how does auth work?' });

    expect(res.batchId).toBe('b-1');
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork%2Fapi');
    expect(c.init?.method).toBe('POST');
    expect(header(c.init, 'Authorization')).toBe('Bearer secret-bearer-xyz');
    expect(header(c.init, 'X-MMA-Client')).toBe('claude-code');
    expect(header(c.init, 'X-MMA-Main-Model')).toBe('claude-opus-4-8');
    expect(bodyOf(c.init)).toEqual({ type: 'investigate', question: 'how does auth work?' });
  });

  it('investigate forwards optional keys when present', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.investigate('/w', {
      question: 'x',
      subtype: 'default',
      tools: 'readonly',
      contextBlockIds: ['cb-1'],
    });
    expect(bodyOf(calls[0]!.init)).toEqual({
      type: 'investigate',
      question: 'x',
      subtype: 'default',
      tools: 'readonly',
      contextBlockIds: ['cb-1'],
    });
  });

  it('research POSTs /task?cwd=<repo> with unified API including type', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.research('/work', {
      researchQuestion: 'what approaches exist for X today?',
      background: 'we are building a thing and need prior art here.',
    });
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork');
    const body = bodyOf(c.init);
    expect(Object.keys(body).sort()).toEqual(['background', 'researchQuestion', 'type']);
    expect(body.type).toBe('research');
    expect(body).not.toHaveProperty('agentType');
    expect(body).not.toHaveProperty('tools');
  });

  it('research rejects a sub-20-char field BEFORE dispatch (never reaches MMA)', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await expect(
      client.research('/work', { researchQuestion: 'too short', background: 'also way too short' }),
    ).rejects.toThrow(/at least 20/);
    expect(calls).toHaveLength(0);
  });

  it('journalRecall POSTs /task?cwd=<workspace root> with unified API { type, query }', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await client.journalRecall('/work', { query: 'what did we learn about caching?' });
    const c = calls[0]!;
    expect(c.url).toBe('http://127.0.0.1:7337/task?cwd=%2Fwork');
    expect(bodyOf(c.init)).toEqual({ type: 'journal_recall', query: 'what did we learn about caching?' });
  });

  it('journalRecall rejects a sub-10-char query before dispatch', async () => {
    const { fn, calls } = stubFetch();
    const client = new MmaClient(baseCfg, { fetchImpl: fn });
    await expect(client.journalRecall('/work', { query: 'short' })).rejects.toThrow(/at least 10/);
    expect(calls).toHaveLength(0);
  });
});
