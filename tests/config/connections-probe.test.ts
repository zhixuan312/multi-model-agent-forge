// @vitest-environment node
import { probeGit, probeOpenai } from '@/config/connections-probe';

const reply = (status: number): typeof fetch =>
  (async () => new Response(status === 200 ? '{}' : '{"error":"x"}', { status })) as unknown as typeof fetch;
const boom: typeof fetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

describe('probeGit', () => {
  it('200 from the git host → ok', async () => {
    const r = await probeGit('ghp_x', { fetchImpl: reply(200) });
    expect(r.ok).toBe(true);
  });
  it('401 → not ok', async () => {
    const r = await probeGit('bad', { fetchImpl: reply(401) });
    expect(r.ok).toBe(false);
  });
  it('empty token → not ok, no call', async () => {
    const fetchImpl = vi.fn();
    const r = await probeGit('', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('network error → not ok', async () => {
    const r = await probeGit('ghp_x', { fetchImpl: boom });
    expect(r.ok).toBe(false);
  });
});

describe('probeOpenai', () => {
  it('200 from /models → ok', async () => {
    const r = await probeOpenai('sk-x', null, { fetchImpl: reply(200) });
    expect(r.ok).toBe(true);
  });
  it('401 → not ok', async () => {
    const r = await probeOpenai('bad', null, { fetchImpl: reply(401) });
    expect(r.ok).toBe(false);
  });
  it('empty key → not ok, no call', async () => {
    const fetchImpl = vi.fn();
    const r = await probeOpenai('', null, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
